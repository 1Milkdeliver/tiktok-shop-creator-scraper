/* Account metadata controls; never derives a display name from a session token. */
(() => {
  const el = id => document.getElementById(id);
  el('cookieCountry').innerHTML = countryOptions('');
  el('partnerAccountCountry').innerHTML = countryOptions('');
  const contactRegion = el('contactRegion');
  const oldRegion = contactRegion.value;
  contactRegion.innerHTML = countryOptions(oldRegion);
  const targetRegion = el('shopRegion'), oldTarget = targetRegion.value;
  const known = new Set([...targetRegion.options].map(option=>option.value));
  for (const [code,name] of AccountCookies.countries) if (!known.has(code)) targetRegion.add(new Option(code+' · '+name,code));
  targetRegion.value=oldTarget;
  const label = document.createElement('label'); label.className = 'continue-country';
  label.append(document.createTextNode('采集国家 / Country '));
  const select = document.createElement('select'); select.id = 'creatorContinueRegion';
  select.setAttribute('aria-label','选择国家继续抓取'); select.innerHTML = countryOptions('');
  label.append(select);
  const button = el('creatorContinueOpen');
  button.parentElement.classList.add('continue-actions'); button.before(label);
  el('contactAccountsOpen').onclick = openAccountSettings;
  el('contactNewTask').onclick = () => { el('autoContacts').checked = true; showPage('tasks'); el('btnStart').focus(); };
})();
