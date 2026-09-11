'use strict';
const {ContactError}=require('./partner-contacts');

// A user acknowledgement gate, not an automatic CAPTCHA solver/retry timer.
class VerificationGate {
  constructor(){this.pending=null;this.checking=false;this.message='';}
  snapshot(){return {waiting:!!this.pending,checking:this.checking,region:this.pending?.region||'',message:this.message};}
  wait({region,check,signal}){
    if(signal?.aborted)return Promise.reject(new ContactError('STOPPED','已停止，断点保留。'));
    if(this.pending)throw new Error('Verification acknowledgement already pending');
    this.message='请在保留的采集页面完成验证，然后点击“我已完成验证，继续抓取”。';
    return new Promise((resolve,reject)=>{
      const abort=()=>{this.pending=null;this.checking=false;reject(new ContactError('STOPPED','已停止，断点保留。'));};
      this.pending={region,check,resolve:()=>{signal?.removeEventListener('abort',abort);this.pending=null;resolve();}};
      signal?.addEventListener('abort',abort,{once:true});
    });
  }
  async confirm(){
    const pending=this.pending;
    if(!pending)return {ok:false,error:'当前没有等待人工验证的任务。'};
    if(this.checking)return {ok:false,error:'正在检查验证状态，请勿重复点击。'};
    this.checking=true;
    try{
      const result=await pending.check();
      if(this.pending!==pending)return {ok:false,error:'任务已结束，断点保留。'};
      if(!result.ok){this.message=result.error;return result;}
      pending.resolve();this.message='正在重试当前请求；以接口成功响应为准。';return {ok:true};
    }catch(_){this.message='无法检查采集页面，请确认页面仍打开；断点已保留。';return {ok:false,error:this.message};}
    finally{this.checking=false;}
  }
}
module.exports={VerificationGate};
