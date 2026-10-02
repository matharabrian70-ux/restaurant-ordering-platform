(function(){
  'use strict';
  const definitions = Object.freeze({
    manager:  { storage: 'session', key: 'savanna_manager_session', cookie: '__Host-manager_session' },
    rider:    { storage: 'session', key: 'rider_session_token', cookie: '__Host-rider_session' },
    platform: { storage: 'local',   key: 'platform_admin_token', cookie: '__Host-platform_session' }
  });
  function definition(role){
    const value=definitions[String(role||'').toLowerCase()];
    if(!value) throw new Error('Unknown authentication role');
    return value;
  }
  function storageFor(kind){ return kind==='local' ? localStorage : sessionStorage; }
  function getLegacyToken(role){ const d=definition(role); return storageFor(d.storage).getItem(d.key)||''; }
  function setLegacyToken(role,token){ const d=definition(role); const s=storageFor(d.storage); if(token)s.setItem(d.key,String(token)); else s.removeItem(d.key); }
  function clearLegacyToken(role){ setLegacyToken(role,''); }
  function authorizationHeader(role){ const token=getLegacyToken(role); return token?{Authorization:'Bearer '+token}:{}; }
  function cookieName(role){ return definition(role).cookie; }
  window.PlatformSession=Object.freeze({
    getLegacyToken,setLegacyToken,clearLegacyToken,authorizationHeader,cookieName,
    definitions
  });
})();
