'use strict';

// Diagnostic only: never changes production defaults or rotates credentials.
// The caller supplies the real market/query adapter and a durable row sink.
async function probeListCapacity({readPage, retainRows, beforeRequest, signal,
  sizes=[12,24,48], direction='ascending', pagesPerSize=2, intervalMs=15000, sleep=ms=>new Promise(r=>setTimeout(r,ms))}) {
  if (![readPage,retainRows,beforeRequest].every(fn=>typeof fn==='function'))
    throw new TypeError('A reader, durable row sink and request gate are required');
  const descending=direction==='descending';
  if (!['ascending','descending'].includes(direction) || !sizes.length || sizes.length>6 || sizes.some((n,i)=>!Number.isInteger(n)||n<1||n>1000||(i>0&&(descending?n>=sizes[i-1]:n<=sizes[i-1]))))
    throw new TypeError('Use at most six ordered sample sizes, up to 1000');
  if (!Number.isFinite(intervalMs)||intervalMs<0) throw new TypeError('Invalid interval');
  if(![1,2].includes(pagesPerSize))throw new TypeError('Use one or two pages per sample');
  const report={kind:'list-capacity-diagnostic',requests:0,samples:[],largestVerifiedSize:null,
    serverMaximumProven:false,stoppedReason:null};
  let baselineIds, previousRequest=false;
  const idOf=row=>String(row?.creator_oecuid?.value??row?.creator_oecuid??'');
  const request=async pagination=>{
    if(signal?.aborted)throw Object.assign(new Error('Stopped'),{code:'STOPPED'});
    await beforeRequest(); // Must refuse a live job/manual-verification conflict.
    if(previousRequest)await sleep(intervalMs,signal);
    if(signal?.aborted)throw Object.assign(new Error('Stopped'),{code:'STOPPED'});
    await beforeRequest();
    previousRequest=true;report.requests++;
    return readPage(pagination,signal);
  };
  for(const size of sizes){
    const sample={requestedSize:size,pages:[],uniqueRows:0,duplicateRows:0,baselineCovered:null,verified:false};
    report.samples.push(sample);
    const ids=new Set();let pagination={size,page:0};
    try{
      for(let page=0;page<pagesPerSize;page++){
        const start=Date.now(),result=await request(pagination);
        if(!Array.isArray(result?.profiles)||typeof result.pagination?.has_more!=='boolean')
          throw Object.assign(new Error('Invalid response'),{code:'RESPONSE'});
        // Save ALL returned rows, even if the service ignores the requested size.
        await retainRows(result.profiles);
        let invalid=0;
        for(const row of result.profiles){
          const id=idOf(row);
          if(!/^\d{1,30}$/.test(id)){invalid++;continue;}
          if(ids.has(id))sample.duplicateRows++;
          ids.add(id);
        }
        sample.pages.push({returned:result.profiles.length,elapsedMs:Date.now()-start,
          hasMore:result.pagination.has_more,fieldCount:new Set(result.profiles.flatMap(row=>Object.keys(row||{}))).size});
        if(invalid)throw Object.assign(new Error('Invalid creator IDs'),{code:'PROFILE_ID'});
        if(!result.profiles.length && result.pagination.has_more)throw Object.assign(new Error('Empty continuing page'),{code:'EMPTY_PAGE'});
        if(!result.pagination.has_more || result.profiles.length<size)break;
        if(page+1===pagesPerSize)break;
        const next=result.pagination;
        if(!Number.isInteger(next.next_page)||next.next_page<=pagination.page)
          throw Object.assign(new Error('Cursor did not advance'),{code:'PAGINATION'});
        // Cursor/search key are opaque. Reuse them; never derive an offset.
        pagination={size,page:next.next_page,search_key:next.search_key||'',next_item_cursor:next.next_item_cursor??0};
      }
      sample.uniqueRows=ids.size;
      const full=sample.pages.length===2&&sample.pages.every(p=>p.returned===size);
      // A clamped high-size sample is not a complete baseline. For descending
      // samples compare smaller sets against the first complete larger sample.
      sample.baselineCovered=baselineIds?(descending?[...ids].every(id=>baselineIds.has(id)):[...baselineIds].every(id=>ids.has(id))):true;
      if(!baselineIds && (!descending||full))baselineIds=new Set(ids);
      sample.verified=full&&sample.duplicateRows===0&&sample.baselineCovered;
      if(sample.verified)report.largestVerifiedSize=Math.max(report.largestVerifiedSize||0,size);
      if(sample.duplicateRows){report.stoppedReason='DUPLICATE_PAGE';break;}
      if(!descending && sample.pages.some(p=>p.returned<size&&p.hasMore)){report.stoppedReason='RETURNED_LESS_THAN_REQUESTED';break;}
      if(!sample.baselineCovered){report.stoppedReason='COVERAGE_CHANGED';break;}
      if(sample.pages.some(p=>!p.hasMore)){report.stoppedReason='RANGE_EXHAUSTED';break;}
    }catch(error){
      sample.uniqueRows=ids.size;
      const safe=new Set(['STOPPED','CHALLENGE','RATE_LIMIT','AUTH','QUOTA','MARKET_AUTH','BUSY','SAVE','NETWORK','TIMEOUT','RESPONSE','PROFILE_ID','EMPTY_PAGE','PAGINATION']);
      report.stoppedReason=safe.has(error.code)?error.code:'PROBE_FAILED';
      break; // No retries/escalation after any failed or restricted response.
    }
  }
  return report;
}
module.exports={probeListCapacity};
