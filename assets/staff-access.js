export function initStaffAccess({ language, onAuthenticated }) {
  const $ = selector => document.querySelector(selector);
  const en = language === 'en';
  const copy = {
    staffOnly: ['PERSONEELTOEGANG','STAFF ACCESS'], email:['E-posadres','Email address'], continue:['Gaan voort','Continue'],
    password:['Wagwoord','Password'], remember:['Onthou hierdie toestel vir 30 dae','Remember this device for 30 days'],
    sharedDevice:['Moenie hierdie opsie op ’n gedeelde of openbare toestel gebruik nie.','Do not use this option on a shared or public device.'],
    signIn:['Meld aan','Sign in'], setupReset:['Eerste toegang of wagwoord vergeet?','First-time access or forgotten password?'],
    differentEmail:['Gebruik ’n ander e-posadres','Use a different email'], emailCode:['E-posverifikasiekode','Email verification code'],
    verifyEmail:['Verifieer e-posadres','Verify email'], resend:['Stuur ’n nuwe kode','Send a new code'], newPassword:['Nuwe wagwoord','New password'],
    confirmPassword:['Bevestig wagwoord','Confirm password'], savePassword:['Stoor wagwoord','Save password'],
    passwordHint:['Gebruik minstens 16 karakters: ’n mengsel van letters, syfers en simbole, of ’n wagwoordfrase van vyf verskillende woorde. Gebruik ’n unieke wagwoord.','Use at least 16 characters: a mix of letters, numbers and symbols, or a passphrase of five different words. Choose a unique password.'],
    scanQr:['Voeg Briljante Boeke by u verifikasie-app deur die QR-kode te skandeer.','Add Briljante Boeke to your authenticator app by scanning this QR code.'],
    manualKey:['Kan u nie die kode skandeer nie?','Unable to scan the code?'], setupKey:['Opstelsleutel — hou dit privaat','Setup key — keep this private'],
    authenticatorCode:['Kode uit u verifikasie-app','Code from your authenticator app'],verifySignIn:['Verifieer en meld aan','Verify and sign in'],
    lostAuthenticator:['As u toegang tot u verifikasie-app verloor het, kontak tegniese ondersteuning.','If you have lost access to your authenticator app, contact technical support.'],
    support:['Tegniese ondersteuning','Technical support'],privacy:['Privaatheid','Privacy'],
    optionalMfa:['’n Verifikasie-app beskerm u rekening indien u wagwoord gesteel word. U kan dit nou of later onder Rekeningsekuriteit opstel.','An authenticator protects your account if your password is stolen. You can set it up now or later under Account security.'],
    enableMfa:['Stel tweestapverifikasie op','Set up two-step verification'],setUpLater:['Stel later op','Set up later'],
    accountSecurity:['Rekeningsekuriteit','Account security'],twoStep:['Tweestapverifikasie','Two-step verification'],
    backDashboard:['Terug na administrasie','Back to dashboard'],
  };
  for (const node of document.querySelectorAll('[data-auth-copy]')) node.textContent = copy[node.dataset.authCopy][en ? 1 : 0];
  for (const node of document.querySelectorAll('[data-toggle-password]')) node.textContent = en ? 'Show' : 'Wys';
  let email = '', factorId = '', busy = false, resendAfter = 0, fromDashboard = false;
  const text = (af, english) => en ? english : af;
  const forms = { email: $('#staff-email-form'), password: $('#staff-password-form'), code: $('#staff-code-form'),
    'new-password': $('#staff-new-password-form'), 'mfa-choice': $('#staff-mfa-choice'), 'mfa-code': $('#staff-mfa-form') };
  const headings = { email: text('Meld aan','Sign in'), password: text('Voer u wagwoord in','Enter your password'),
    code: text('Verifieer u e-posadres','Verify your email'), 'new-password':text('Stel u wagwoord op','Set your password'),
    'mfa-code':text('Tweestapverifikasie','Two-step verification'), 'mfa-choice':text('Tweestapverifikasie','Two-step verification') };
  const intros = { email:text('Voer u goedgekeurde e-posadres in om voort te gaan.','Enter your approved email address to continue.'),
    password:text('Gebruik u wagwoord, of kies rekeningopstelling vir eerste toegang.','Use your password, or choose account setup for first-time access.'),
    code:text('Indien hierdie adres goedgekeur is, sal ’n kode gestuur word. Kyk ook in u strooipos. Die kode verval oor 15 minute.','If this address is approved, a code will be sent. Check your inbox and spam folder. The code expires in 15 minutes.'),
    'new-password':text('U e-posadres is geverifieer. Kies ’n unieke wagwoord.','Your email is verified. Choose a unique password.'),
    'mfa-code':text('Verifieer u identiteit om toegang tot die administrasie te kry.','Verify your identity to access administration.'),
    'mfa-choice':text('Tweestapverifikasie is opsioneel.','Two-step verification is optional.') };
  function stage(name, focus = true) {
    for (const [key, form] of Object.entries(forms)) form.hidden = key !== name;
    $('#login-message').textContent = '';
    $('#staff-access-title').textContent = headings[name];
    $('#staff-access-intro').textContent = intros[name];
    $('#staff-email-summary').textContent = email;
    $('#staff-email-summary').hidden = !email || name === 'email';
    if (focus) $('#staff-access-title').focus();
  }
  async function request(action, values = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/admin-login', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action,...values}), signal:controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || text('Meld asseblief weer aan.','Please sign in again.'));
      return data;
    } finally { clearTimeout(timeout); }
  }
  async function run(task) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('.auth-step button').forEach(button => button.disabled = true);
    $('#login-message').textContent = '';
    try { await task(); }
    catch (error) { $('#login-message').textContent = error.name === 'AbortError' ? text('Die versoek het uitgetel. Probeer asseblief weer.','The request timed out. Please try again.') : error.message; }
    finally { busy = false; document.querySelectorAll('.auth-step button').forEach(button => button.disabled = false); }
  }
  async function next(result) {
    if (result.next === 'dashboard') {
      $('#staff-mfa-qr').removeAttribute('src'); $('#staff-mfa-key').value = '';
      forms['mfa-code'].reset(); factorId = ''; fromDashboard = false;
      await onAuthenticated(result.staff); return;
    }
    if (result.next === 'mfa') {
      await next(await request('mfa-options')); return;
    }
    if (result.next === 'mfa-code') {
      factorId = result.factor_id;
      $('#staff-mfa-enrolment').hidden = !result.enrolling;
      $('#staff-mfa-skip').hidden = !result.can_skip;
      $('#staff-mfa-cancel').hidden = !result.can_cancel;
      $('#staff-mfa-qr').removeAttribute('src'); $('#staff-mfa-key').value = '';
      if (result.enrolling && result.qr_code?.startsWith('data:image/svg+xml')) {
        $('#staff-mfa-qr').src = result.qr_code; $('#staff-mfa-key').value = result.manual_key;
      }
      stage('mfa-code'); return;
    }
    if (result.next === 'mfa-choice') {
      $('#staff-choice-skip').hidden = fromDashboard;
      $('#staff-choice-cancel').hidden = !fromDashboard;
    }
    if (forms[result.next]) stage(result.next);
  }
  forms.email.addEventListener('submit', event => {
    event.preventDefault(); email = $('#staff-email').value.trim().toLowerCase();
    stage('password'); $('#staff-password').focus();
  });
  forms.password.addEventListener('submit', event => {
    event.preventDefault(); run(async () => {
      const password = $('#staff-password').value;
      try { await next(await request('password',{email,password,remember:$('#staff-remember').checked})); }
      finally { $('#staff-password').value = ''; }
    });
  });
  async function sendCode() {
    if (Date.now() < resendAfter) throw new Error(text('Wag asseblief ’n minuut voordat u weer ’n kode aanvra.','Please wait a minute before requesting another code.'));
    const result = await request('request-code',{email,remember:$('#staff-remember').checked});
    resendAfter = Date.now() + 60000; $('#staff-password').value = ''; await next(result);
  }
  $('#staff-request-code').addEventListener('click',() => run(sendCode));
  $('#staff-resend-code').addEventListener('click',() => run(sendCode));
  forms.code.addEventListener('submit',event => { event.preventDefault(); run(async () => {
    const code = $('#staff-email-code').value; $('#staff-email-code').value = '';
    await next(await request('verify-code',{code}));
  }); });
  forms['new-password'].addEventListener('submit',event => { event.preventDefault(); run(async () => {
    const values = Object.fromEntries(new FormData(forms['new-password']));
    if (values.password !== values.confirmation) throw new Error(text('Die wagwoorde stem nie ooreen nie.','The passwords do not match.'));
    try { await next(await request('new-password',values)); }
    finally { forms['new-password'].reset(); }
  }); });
  forms['mfa-code'].addEventListener('submit',event => { event.preventDefault(); run(async () => {
    const field = forms['mfa-code'].elements.code; const code = field.value; field.value = '';
    await next(await request('mfa-verify',{factor_id:factorId,code}));
  }); });
  forms['mfa-choice'].addEventListener('submit', event => { event.preventDefault(); run(async () => next(await request('mfa-begin'))); });
  for (const id of ['#staff-choice-skip','#staff-mfa-skip']) $(id).addEventListener('click',() => run(async () => next(await request('mfa-skip'))));
  for (const id of ['#staff-choice-cancel','#staff-mfa-cancel']) $(id).addEventListener('click',() => run(async () => next(await request('status'))));
  for (const button of document.querySelectorAll('[data-auth-start-over]')) button.addEventListener('click',() => {
    email = ''; forms.password.reset(); stage('email'); $('#staff-email').focus();
  });
  for (const button of document.querySelectorAll('[data-toggle-password]')) button.addEventListener('click',() => {
    const field = document.getElementById(button.dataset.togglePassword);
    const show = field.type === 'password'; field.type = show ? 'text' : 'password';
    button.setAttribute('aria-pressed',String(show)); button.textContent = show ? text('Verberg','Hide') : text('Wys','Show');
  });
  stage('email',false);
  return {
    async resume() { try { await next(await request('status')); } catch { stage('email',false); } },
    startSetup() {
      fromDashboard = true; $('#admin-app').hidden = true; $('#login-view').hidden = false;
      next({next:'mfa-choice'});
    },
  };
}
