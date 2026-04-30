// ═══════════════════════════════════════════════════════════════
// UI · CARD — card building, sorting, shift-time display
// Extracted from app.js (Sprint 6)
// Depends on: core/time.js, core/phone-resolver.js, core/entry-model.js,
//             core/lanes.js, resolver/shift-filter.js, store/memory-cache.js
// ═══════════════════════════════════════════════════════════════

function escapeHtml(s='') {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function homepageLabel(label='') {
  return (label || '').split(' / ')[0].split('/')[0].trim();
}

function sortEntries(entries=[], deptKey='') {
  return [...entries].sort((a,b) => {
    const shiftOrder = label => label === 'Current Shift' ? 0 : label === 'Upcoming Shift' ? 1 : 0;
    const sa = shiftOrder(a.shiftLabel); const sb = shiftOrder(b.shiftLabel);
    if (sa !== sb) return sa - sb;
    const pa = getLaneTier(deptKey, a); const pb = getLaneTier(deptKey, b);
    if (pa !== pb) return pa - pb;
    return (a.role||'').localeCompare(b.role||'');
  });
}

function getShiftTime(entry={}, now=new Date(), deptKey='') {
  if (entry.shiftTime) return entry.shiftLabel ? `${entry.shiftLabel} · ${entry.shiftTime}` : entry.shiftTime;
  if (entry.hours) return entry.hours;
  if (entry.startTime && entry.endTime) return `${entry.startTime}-${entry.endTime}`;
  const after = (entry.role || '').match(/after\s+(\d{1,2})(?::(\d{2}))?/i);
  if (after) return `after ${after[1].padStart(2,'0')}:${after[2] || '00'}`;
  if (entry.coverageType === 'on-duty' || entry.coverageType === 'consult coverage' || entry.coverageType === 'inpatient coverage') return '07:30-16:30';
  if (entry.coverageType === 'on-call') return '16:30-07:30';
  const meta = parseRoleMeta(entry.role || '');
  if (meta.startTime && meta.endTime) return `${meta.startTime}-${meta.endTime}`;
  if (roleText(entry).includes('24h')) return '24h';
  const sw = inferShiftWindow(entry, deptKey);
  if (sw) {
    if (sw.type === '24h') return '24h';
    return `${sw.start}-${sw.end}`;
  }
  return isWorkHours(now) ? '07:30-16:30' : '16:30-07:30';
}

function getEntrySection(entry={}, dept) {
  return entry.section || entry.coverage || dept.label || '';
}

function getPdfPreviewContext(deptKey, entries=[], qLow='') {
  if (deptKey !== 'radiology_duty' && deptKey !== 'radiology_oncall') return null;
  const intent = radiologyQueryIntent(qLow || '');
  const names = entries.map(entry => entry.name).filter(Boolean);
  if (intent === 'ct_neuro_er') {
    return {
      page: 1,
      section: 'CT Neuro (ER)',
      highlightTerms: ['CT Neuro (ER)', ...names],
    };
  }
  const firstSection = entries.find(entry => entry.section)?.section || '';
  const pageMap = {
    'CT - Neuro': 1,
    'CT (In-Patient & ER)': 1,
    'Body Ultrasound': 1,
    'Ultrasound - MSK': 2,
    'Breast In Pt. & Emergency': 2,
    'Thoracic CT/MRI (In-Pt & ER)': 2,
    'Nuclear / PET': 3,
    'CT Neuro (ER)': 1,
  };
  if (!firstSection) return null;
  return {
    page: pageMap[firstSection] || 1,
    section: firstSection,
    highlightTerms: [firstSection, ...names],
  };
}

async function copyPhoneNumber(phone, button) {
  if (!phone) return;
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(phone);
    } else {
      const tmp = document.createElement('textarea');
      tmp.value = phone;
      tmp.style.position = 'fixed';
      tmp.style.opacity = '0';
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand('copy');
      tmp.remove();
    }
    const oldText = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = oldText; }, 1200);
  } catch (err) {
    console.warn('Copy failed', err);
  }
}

function isDeptHardBlocked(deptKey) {
  const dept = ROTAS[deptKey];
  if (isImagingDeptKey(deptKey)) {
    return !!(dept && dept.auditBlocked);
  }
  const uploaded = uploadedRecordForDept(deptKey);
  const hasBuiltInSchedule = !!(dept && dept.schedule && Object.keys(dept.schedule).length);
  if (uploaded && uploaded.review && (uploaded.review.parsing || uploaded.review.auditRejected)) {
    if (!hasBuiltInSchedule || dept?.uploadedOnly) return true;
  }
  return !!(dept && dept.auditBlocked);
}

function uploadBlockReasonSummary(record=null) {
  const codes = record?.diagnostics?.activation?.reasonCodes || [];
  if (!codes.length) return '';
  return codes.map(reasonCodeExplanation).join(' · ');
}

function buildRadiologyDutyTraceHtml() {
  const searchTrace = radiologyDutyTrace.lastSearch || null;
  const pdfTrace = radiologyDutyTrace.lastPdf || null;
  if (!searchTrace && !pdfTrace) return '';
  const lines = [];
  if (searchTrace) {
    const parts = [
      `search source=${searchTrace.source || 'unknown'}`,
      searchTrace.recordName ? `record=${searchTrace.recordName}` : '',
      searchTrace.intent ? `intent=${searchTrace.intent}` : '',
      Number.isFinite(searchTrace.rowCountBeforeDedupe) ? `rows=${searchTrace.rowCountBeforeDedupe}->${searchTrace.rowCountAfterDedupe}` : '',
      searchTrace.reason ? `reason=${searchTrace.reason}` : '',
    ].filter(Boolean);
    lines.push(`<div class="radiology-trace-line">${escapeHtml(parts.join(' · '))}</div>`);
  }
  if (pdfTrace) {
    const parts = [
      `pdf source=${pdfTrace.source || 'unknown'}`,
      pdfTrace.recordName ? `file=${pdfTrace.recordName}` : '',
    ].filter(Boolean);
    lines.push(`<div class="radiology-trace-line">${escapeHtml(parts.join(' · '))}</div>`);
  }
  return `<div class="radiology-trace">${lines.join('')}</div>`;
}

async function buildCard(deptKey, dept, entries) {
  const card = document.createElement('div');
  card.className = 'dcard';
  const pdf = await getPdfHref(deptKey);
  const now = new Date();
  let rowsHtml = '';
  const hasRenderableEntries = Array.isArray(entries) && entries.length && !entries.every(isNoCoverageEntry);

  // Imaging On-Duty: always show "Needs Review" instead of doctor list
  if (deptKey === 'radiology_duty') {
    rowsHtml = `<div class="empty" style="text-align:center;padding:14px 12px;font-size:13px;">Needs Review<br>يرجى مراجعة الجدول الأصلي للتأكد من البيانات</div>`;
  } else if (isDeptHardBlocked(deptKey) && !hasRenderableEntries) {
    const uploaded = uploadedRecordForDept(deptKey);
    const reasonText = uploadBlockReasonSummary(uploaded);
    rowsHtml = `<div class="empty">Needs review${reasonText ? ` · ${escapeHtml(reasonText)}` : ''}</div>`;
  } else if (!entries || entries.length === 0) {
    const uploaded = uploadedRecordForDept(deptKey);
    const _hasBuiltIn = ROTAS[deptKey] && ROTAS[deptKey].schedule && Object.keys(ROTAS[deptKey].schedule).length > 0;
    if (uploaded && uploaded.review && (uploaded.review.parsing || uploaded.review.auditRejected) && !_hasBuiltIn) {
      const reasonText = uploadBlockReasonSummary(uploaded);
      rowsHtml = `<div class="empty">Parsing failed - review needed${reasonText ? ` · ${escapeHtml(reasonText)}` : ''}</div>`;
    } else if ((deptKey === 'radiology_duty' || deptKey === 'radiology_oncall') && imagingIconForced === deptKey) {
      rowsHtml = '<div class="empty">No active coverage</div>';
    } else {
      rowsHtml = '<div class="empty">No active on-call found</div>';
    }
  } else if (entries.every(isNoCoverageEntry)) {
    rowsHtml = '<div class="empty">No coverage</div>';
  } else {
    const isRadiology = deptKey === 'radiology_duty' || deptKey === 'radiology_oncall';
    const hasUpcoming = isRadiology && entries.some(e => e.shiftLabel === 'Upcoming Shift');
    let currentSectionLabel = null;

    entries.forEach(e => {
      const ph = resolvePhone(dept, e);
      const displayName = (ph && !ph.uncertain && ph.matchedName) ? ph.matchedName : e.name;
      const explicitNameReview = typeof e.doctorNameUncertain === 'boolean' ? e.doctorNameUncertain : isNameUncertain(displayName);
      const nameReview = explicitNameReview && !(deptKey === 'radiology_duty' && e.parsedFromPdf);
      const phone = ph ? cleanPhone(ph.phone) : '';
      const phoneText = ph ? `${ph.phone}${ph.uncertain ? ' ?' : ''}` : '';
      const shiftTime = getShiftTime(e, now, deptKey);
      const section = getEntrySection(e, dept);

      const conf = e._confidence || 'high';
      const confMark = conf === 'low'    ? ' <span title="Low confidence — review recommended" style="color:var(--red,#ff5252);font-size:10px;">⚠️</span>'
                     : conf === 'medium' ? ' <span title="Medium confidence" style="color:var(--amber,#ffab40);font-size:10px;">?</span>'
                     : '';

      const isUpcomingEntry = isRadiology && e.shiftLabel === 'Upcoming Shift';
      const rowStyle = isUpcomingEntry
        ? 'opacity:0.45;filter:grayscale(0.6);border-left:3px solid rgba(120,120,120,0.3);'
        : '';
      const rowClass = isUpcomingEntry ? 'drow drow-upcoming' : 'drow';

      if (isRadiology && e.shiftLabel && e.shiftLabel !== currentSectionLabel) {
        currentSectionLabel = e.shiftLabel;
        const isUpcomingSection = e.shiftLabel === 'Upcoming Shift';
        rowsHtml += `<div class="drow-section-header" style="${isUpcomingSection ? 'opacity:0.55;color:var(--text-3,#888);font-size:11px;' : 'font-size:11px;color:var(--accent,#7ee8fa);'}">
          ${isUpcomingSection ? '🕐 Upcoming: ' : '✅ Current: '}${e.shiftLabel} · ${e.shiftTime || ''}
        </div>`;
      }

      rowsHtml += `
        <div class="${rowClass}" style="${rowStyle}">
          <div class="dinfo">
            <div class="ddrname">${displayName}${nameReview ? ' ?' : ''}${confMark}</div>
            <div class="drrole">${e.role}</div>
            <div class="dsection">${section}</div>
            <div class="dshift">${shiftTime}</div>
          </div>
          <div class="dmeta">
            ${ph ? `<div class="ph">${phoneText}</div>` : '<span class="noph">No number</span>'}
            ${ph ? `<div class="row-actions">
              ${ph.uncertain ? '<span class="callbtn disabled">Call</span>' : `<a class="callbtn" href="tel:${phone}">Call</a>`}
              <button class="callbtn copy" type="button" data-copy-phone="${phone}">Copy Number</button>
            </div>` : ''}
          </div>
        </div>`;
    });
  }
  const pdfBtns = pdf ? `
    <button class="ghostbtn" type="button" data-preview="${deptKey}">عرض داخل الصفحة</button>
    <a class="ghostbtn" href="${pdf.href}" target="_blank" rel="noopener">فتح PDF</a>
    <a class="ghostbtn" href="${pdf.href}" download="${pdf.name || 'rota.pdf'}">تحميل</a>` : '';
  const traceHtml = '';
  card.innerHTML = `
    <div class="dhead">
      <div class="dname"><div class="dicon" data-exact-specialty="${deptKey}" title="Show only this specialty">${dept.icon}</div>${dept.label}</div>
      <div class="hactions">
        <span class="dbadge">${isSpecialtyActiveNow(deptKey, now) ? 'On-Call Now' : 'Upcoming'}</span>${pdfBtns}
      </div>
    </div>
    <div class="beta-warning-banner">⚠️ This is Beta Version - PLEASE double check using the rota below before calling.</div>
    ${pdf && pdf.name ? `<div style="font-size:11px;color:var(--muted);padding:0 16px 4px;opacity:0.7">📄 ${escapeHtml(pdf.name)}${pdf.uploadedAt ? ' · ' + new Date(pdf.uploadedAt).toLocaleDateString('en-GB') : ''}</div>` : ''}
    <div class="dgrid">${rowsHtml}${traceHtml}</div>`;
  return card;
}
