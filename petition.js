/* BMet Friday prayer room petition — public form (signature pad, review step,
   saves to Firestore through its REST API). Once someone has signed, the
   banner is removed from that phone for good. */
(function () {
    'use strict';
    var CFG = window.PETITION_CONFIG || {};
    var SIGNED_KEY = 'bmet-petition-signed';
    var banner = document.getElementById('petition-banner');
    if (!banner) return;

    function hasSigned() {
        try { if (localStorage.getItem(SIGNED_KEY)) return true; } catch (e) {}
        return document.cookie.indexOf('bmet_petition_signed=1') > -1;
    }
    function markSigned() {
        try { localStorage.setItem(SIGNED_KEY, String(Date.now())); } catch (e) {}
        document.cookie = 'bmet_petition_signed=1; max-age=' + (60 * 60 * 24 * 365 * 5) + '; path=/; SameSite=Lax';
    }
    function removeBanner() { if (banner.parentNode) banner.parentNode.removeChild(banner); }

    if (!(CFG.projectId && CFG.apiKey) || hasSigned()) { removeBanner(); return; }
    banner.hidden = false;
    document.getElementById('petition-open').addEventListener('click', openModal);

    /* ---------- styles ---------- */
    var css = document.createElement('style');
    css.textContent =
    '.pt-overlay{position:fixed;inset:0;z-index:9999;background:rgba(10,30,24,.72);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:16px;-webkit-overflow-scrolling:touch}' +
    '.pt-card{background:#FBFAF4;border-radius:22px;width:100%;max-width:560px;margin:auto;padding:22px 20px 20px;box-shadow:0 30px 70px -20px rgba(0,0,0,.6);color:#16231D;font-family:inherit}' +
    '.pt-head{display:flex;align-items:center;gap:12px;margin-bottom:6px}.pt-head img{width:44px;height:44px;object-fit:contain}' +
    '.pt-title{font-weight:800;font-size:1.2rem;line-height:1.2;margin:0}.pt-sub{font-size:12px;color:#5B6B63;margin:0}' +
    '.pt-x{margin-left:auto;border:0;background:#ECE8D8;border-radius:50%;width:36px;height:36px;font-size:18px;cursor:pointer;color:#16231D}' +
    '.pt-intro{font-size:13px;line-height:1.5;color:#33433B;background:#F0EDDD;border-radius:14px;padding:10px 12px;margin:10px 0 14px}' +
    '.pt-field{margin-bottom:12px}.pt-field label{display:block;font-weight:700;font-size:13px;margin-bottom:4px}' +
    '.pt-field input,.pt-field select{width:100%;box-sizing:border-box;padding:12px 12px;font-size:16px;border:1.5px solid #CFC9B0;border-radius:12px;background:#fff;color:#16231D;font-family:inherit}' +
    '.pt-field input:focus,.pt-field select:focus{outline:none;border-color:#0E4B3A;box-shadow:0 0 0 3px rgba(14,75,58,.18)}' +
    '.pt-row{display:flex;gap:10px}.pt-row .pt-field{flex:1;min-width:0}' +
    '.pt-sig{width:100%;height:170px;border:2px dashed #A9812E;border-radius:14px;background:#fff;touch-action:none;display:block}' +
    '.pt-sig-bar{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#5B6B63;margin-top:4px}' +
    '.pt-link{border:0;background:none;color:#0E4B3A;font-weight:700;font-size:13px;cursor:pointer;text-decoration:underline;padding:4px}' +
    '.pt-err{color:#9A3B2B;font-size:13px;font-weight:600;margin:6px 0;min-height:0}' +
    '.pt-btns{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}' +
    '.pt-btn{flex:1 1 140px;padding:14px 18px;border-radius:999px;font-weight:800;font-size:15px;border:2px solid #0E4B3A;cursor:pointer;background:#fff;color:#0E4B3A;font-family:inherit}' +
    '.pt-btn.primary{background:#0E4B3A;color:#fff}.pt-btn:disabled{opacity:.55;cursor:default}' +
    '.pt-remind{background:#FFF6DA;border:1.5px solid #D4A93C;border-radius:14px;padding:12px 14px;font-size:14px;line-height:1.45;margin:10px 0}' +
    '.pt-sum{margin:10px 0;border:1px solid #E1DCC6;border-radius:14px;overflow:hidden;background:#fff}' +
    '.pt-sum div{display:flex;gap:10px;padding:9px 12px;border-bottom:1px solid #EFEBD9;font-size:14px}.pt-sum div:last-child{border-bottom:0}' +
    '.pt-sum b{flex:0 0 110px;color:#5B6B63;font-weight:600}.pt-sum span{flex:1;font-weight:700;word-break:break-word}' +
    '.pt-sum img{max-width:100%;height:70px;object-fit:contain}' +
    '.pt-check{display:flex;gap:10px;align-items:flex-start;font-size:14px;font-weight:600;margin:10px 0;cursor:pointer}.pt-check input{width:22px;height:22px;margin-top:1px;accent-color:#0E4B3A}' +
    '.pt-note{font-size:11px;color:#5B6B63;margin-top:12px;line-height:1.4}' +
    '.pt-hp{position:absolute;left:-9999px;opacity:0;height:0;width:0}' +
    '.pt-done{text-align:center;padding:18px 6px}.pt-done .tick{width:64px;height:64px;border-radius:50%;background:#0E4B3A;color:#F0CD6E;font-size:34px;line-height:64px;margin:0 auto 12px}' +
    '.apply-banner[hidden]{display:none}';
    document.head.appendChild(css);

    /* ---------- helpers ---------- */
    function todayISO() {
        var d = new Date(), m = ('0' + (d.getMonth() + 1)).slice(-2), day = ('0' + d.getDate()).slice(-2);
        return d.getFullYear() + '-' + m + '-' + day;
    }
    function fmtDate(iso) { var p = String(iso).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso; }
    function $(id) { return document.getElementById(id); }

    /* ---------- signature pad (strokes kept normalised so rotating the phone never loses them) ---------- */
    function SigPad(canvas) {
        var ctx = canvas.getContext('2d'), strokes = [], cur = null;
        function size() {
            var dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
            canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr));
            redraw();
        }
        function pt(e) { var r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; }
        function redraw() {
            ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0B1F4D';
            ctx.lineWidth = Math.max(2, canvas.width / 190);
            strokes.forEach(function (s) {
                ctx.beginPath();
                s.forEach(function (p, i) { var x = p[0] * canvas.width, y = p[1] * canvas.height; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
                if (s.length === 1) ctx.lineTo(s[0][0] * canvas.width + .1, s[0][1] * canvas.height + .1);
                ctx.stroke();
            });
        }
        canvas.addEventListener('pointerdown', function (e) {
            e.preventDefault(); try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
            cur = [pt(e)]; strokes.push(cur); redraw();
        });
        canvas.addEventListener('pointermove', function (e) { if (!cur) return; e.preventDefault(); cur.push(pt(e)); redraw(); });
        function end() { cur = null; }
        canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); canvas.addEventListener('pointerleave', end);
        window.addEventListener('resize', size);
        this.clear = function () { strokes = []; cur = null; redraw(); };
        this.isSigned = function () {
            var n = 0, minX = 1, maxX = 0, minY = 1, maxY = 0;
            strokes.forEach(function (s) { s.forEach(function (p) { n++; minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }); });
            return n >= 12 && (maxX - minX) > 0.08;
        };
        this.toDataURL = function () {
            var c = document.createElement('canvas'); c.width = 600; c.height = Math.round(600 * canvas.height / canvas.width);
            var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
            x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#0B1F4D'; x.lineWidth = 3.2;
            strokes.forEach(function (s) {
                x.beginPath();
                s.forEach(function (p, i) { var px = p[0] * c.width, py = p[1] * c.height; if (i === 0) x.moveTo(px, py); else x.lineTo(px, py); });
                if (s.length === 1) x.lineTo(s[0][0] * c.width + .1, s[0][1] * c.height + .1);
                x.stroke();
            });
            return c.toDataURL('image/png');
        };
        this.resize = size;
    }

    /* ---------- modal ---------- */
    var overlay, pad, data, submitting = false, prevOverflow;
    function openModal() {
        if (overlay) return;
        overlay = document.createElement('div'); overlay.className = 'pt-overlay';
        overlay.innerHTML =
        '<div class="pt-card" role="dialog" aria-modal="true" aria-labelledby="pt-h">' +
          '<div class="pt-head"><img src="bmet-logo.png" alt=""><div><h2 class="pt-title" id="pt-h">Bigger Friday Prayer Room</h2><p class="pt-sub">BMet Matthew Boulton College &bull; Student petition</p></div><button class="pt-x" id="pt-close" aria-label="Close">&times;</button></div>' +
          '<div id="pt-step-form">' +
            '<div class="pt-intro">We respectfully request permission to use the <b>ground floor hall</b> for about 20 minutes every Friday for Jumu\'ah prayer, between 12:00 pm and 1:30 pm, because our current prayer room has limited space. Your signature shows the college how many students support this.</div>' +
            '<div class="pt-field"><label for="pt-name">Full name</label><input id="pt-name" autocomplete="name" maxlength="80" placeholder="e.g. Ahmed Khan"></div>' +
            '<div class="pt-row"><div class="pt-field"><label for="pt-id">Student ID number</label><input id="pt-id" autocapitalize="characters" autocomplete="off" maxlength="20" placeholder="e.g. 25000698"></div>' +
            '<div class="pt-field"><label for="pt-year">Course year</label><select id="pt-year"><option value="">Select…</option><option>Year 1</option><option>Year 2</option><option>Year 3</option><option>Year 4</option><option>Other</option></select></div></div>' +
            '<div class="pt-field"><label for="pt-course">Course name</label><input id="pt-course" autocomplete="off" maxlength="80" placeholder="e.g. Level 3 Computing"></div>' +
            '<div class="pt-field"><label for="pt-date">Date</label><input id="pt-date" type="date"></div>' +
            '<div class="pt-field"><label>Your signature <span style="font-weight:400;color:#5B6B63">(draw with your finger)</span></label><canvas class="pt-sig" id="pt-sig"></canvas>' +
            '<div class="pt-sig-bar"><span>Sign inside the box</span><button type="button" class="pt-link" id="pt-clear">Clear signature</button></div></div>' +
            '<input class="pt-hp" id="pt-hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
            '<div class="pt-err" id="pt-err" role="alert"></div>' +
            '<div class="pt-btns"><button class="pt-btn primary" id="pt-next">Review my details →</button></div>' +
            '<p class="pt-note">Your details are used only for this petition and will be shared with college management. One signature per student.</p>' +
          '</div>' +
          '<div id="pt-step-review" style="display:none">' +
            '<div class="pt-remind"><b>Please double-check your details.</b> Make sure your name and student ID are spelled correctly &mdash; you can\'t edit them after submitting.</div>' +
            '<div class="pt-sum" id="pt-sum"></div>' +
            '<label class="pt-check"><input type="checkbox" id="pt-ok"><span>I\'ve checked everything and these details are correct.</span></label>' +
            '<div class="pt-err" id="pt-err2" role="alert"></div>' +
            '<div class="pt-btns"><button class="pt-btn" id="pt-back">← Edit details</button><button class="pt-btn primary" id="pt-submit" disabled>Confirm &amp; submit</button></div>' +
          '</div>' +
          '<div id="pt-step-done" style="display:none" class="pt-done"><div class="tick">✓</div><h2 class="pt-title" style="font-size:1.4rem">Thank you!</h2>' +
            '<p style="margin:8px 0 16px;font-size:15px;line-height:1.5" id="pt-done-msg">Your support has been recorded. JazakAllah khair.</p><button class="pt-btn primary" id="pt-finish">Close</button></div>' +
        '</div>';
        document.body.appendChild(overlay);
        prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
        $('pt-date').value = todayISO();
        pad = new SigPad($('pt-sig')); pad.resize();
        $('pt-clear').onclick = function () { pad.clear(); };
        $('pt-close').onclick = closeModal;
        $('pt-next').onclick = toReview;
        $('pt-back').onclick = function () { show('form'); setTimeout(function () { pad.resize(); }, 0); };
        $('pt-ok').onchange = function () { $('pt-submit').disabled = !this.checked || submitting; };
        $('pt-submit').onclick = submit;
        $('pt-finish').onclick = finish;
        document.addEventListener('keydown', onKey);
        setTimeout(function () { $('pt-name').focus(); }, 50);
    }
    function onKey(e) { if (e.key === 'Escape' && !submitting) closeModal(); }
    function closeModal() {
        if (!overlay) return;
        document.removeEventListener('keydown', onKey);
        document.body.style.overflow = prevOverflow || '';
        overlay.parentNode.removeChild(overlay); overlay = null;
    }
    function show(step) {
        ['form', 'review', 'done'].forEach(function (s) { $('pt-step-' + s).style.display = s === step ? '' : 'none'; });
        overlay.scrollTop = 0;
    }

    function toReview() {
        var name = $('pt-name').value.replace(/\s+/g, ' ').trim();
        var id = $('pt-id').value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
        var course = $('pt-course').value.replace(/\s+/g, ' ').trim();
        var year = $('pt-year').value, date = $('pt-date').value, err = $('pt-err');
        var msg = '';
        if (name.length < 3 || !/[A-Za-z\u00C0-\u024F\u0600-\u06FF]/.test(name)) msg = 'Please enter your full name.';
        else if (id.length < 4) msg = 'Please enter your student ID number (at least 4 characters).';
        else if (course.length < 2) msg = 'Please enter your course name.';
        else if (!year) msg = 'Please choose your course year.';
        else if (!date) msg = 'Please choose the date.';
        else if (!pad.isSigned()) msg = 'Please sign inside the box with your finger.';
        err.textContent = msg; if (msg) return;
        data = { fullName: name, studentId: id, course: course, year: year, date: date, signature: pad.toDataURL() };
        var sum = $('pt-sum'); sum.innerHTML = '';
        [['Full name', name], ['Student ID', id], ['Course', course], ['Year', year], ['Date', fmtDate(date)]].forEach(function (r) {
            var row = document.createElement('div'), b = document.createElement('b'), s = document.createElement('span');
            b.textContent = r[0]; s.textContent = r[1]; row.appendChild(b); row.appendChild(s); sum.appendChild(row);
        });
        var srow = document.createElement('div'), sb = document.createElement('b'), ss = document.createElement('span'), im = document.createElement('img');
        sb.textContent = 'Signature'; im.src = data.signature; im.alt = 'Your signature'; ss.appendChild(im); srow.appendChild(sb); srow.appendChild(ss); sum.appendChild(srow);
        $('pt-ok').checked = false; $('pt-submit').disabled = true; $('pt-err2').textContent = '';
        show('review');
    }

    function fs(v) { return { stringValue: v }; }
    function submit() {
        if (submitting) return;
        if ($('pt-hp').value) { markSigned(); showDone('Thank you!'); return; }   // bots fill hidden fields
        if (!navigator.onLine) { $('pt-err2').textContent = 'You seem to be offline. Please connect to the internet and try again.'; return; }
        submitting = true; $('pt-submit').disabled = true; $('pt-submit').textContent = 'Submitting…'; $('pt-err2').textContent = '';
        var url = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(CFG.projectId) +
                  '/databases/(default)/documents/petition?documentId=' + encodeURIComponent(data.studentId) + '&key=' + encodeURIComponent(CFG.apiKey);
        var body = { fields: {
            fullName: fs(data.fullName), studentId: fs(data.studentId), course: fs(data.course), year: fs(data.year),
            date: fs(data.date), signature: fs(data.signature), createdAt: fs(new Date().toISOString())
        } };
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(function (r) {
                submitting = false;
                if (r.ok) { markSigned(); showDone('Your support has been recorded. JazakAllah khair.'); }
                else if (r.status === 409) { markSigned(); showDone('This student ID has already signed — thank you for your support!'); }
                else if (r.status === 403) { $('pt-submit').textContent = 'Confirm & submit'; $('pt-err2').textContent = 'This student ID may have already signed. If you haven\'t signed yet, please tell the prayer team.'; }
                else { fail(); }
            })
            .catch(function () { submitting = false; fail(); });
    }
    function fail() {
        $('pt-submit').textContent = 'Confirm & submit'; $('pt-submit').disabled = !$('pt-ok').checked;
        $('pt-err2').textContent = 'Sorry, we couldn\'t send your signature. Please check your connection and try again.';
    }
    function showDone(msg) { $('pt-done-msg').textContent = msg; show('done'); removeBanner(); }
    function finish() { closeModal(); }
})();
