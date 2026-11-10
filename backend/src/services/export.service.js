// PDF (pdfkit) and Excel (exceljs) export for any report produced by report.service.
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const env = require('../config/env');

const NAVY = '#172B3A';
const GOLD = '#C6A56B';
const GRAY = '#6b7280';

const fmtMoney = (n) => `PHP ${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function fmt(value, type) {
  if (value === null || value === undefined || value === '') return '';
  switch (type) {
    case 'money': return fmtMoney(value);
    case 'percent': return `${Number(value).toFixed(1)}%`;
    case 'number': return Number(value).toLocaleString('en-PH');
    case 'datetime': return new Date(value).toLocaleString('en-PH', { timeZone: env.timezone, dateStyle: 'medium', timeStyle: 'short' });
    case 'status': return String(value).replace(/_/g, ' ');
    default: return String(value);
  }
}

function pdfBuffer(build, opts = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, ...opts });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

function header(doc, hotelName, title, subtitle) {
  doc.rect(0, 0, doc.page.width, 70).fill(NAVY);
  doc.fillColor('#ffffff').font('Times-Roman').fontSize(20).text(hotelName, 40, 22);
  doc.fillColor(GOLD).font('Helvetica').fontSize(9).text('HOTEL MANAGEMENT REPORT', 40, 46, { characterSpacing: 1.5 });
  doc.fillColor(NAVY).font('Times-Bold').fontSize(16).text(title, 40, 90);
  if (subtitle) doc.fillColor(GRAY).font('Helvetica').fontSize(9).text(subtitle, 40, 110);
  doc.fillColor(GRAY).fontSize(8).text(`Generated ${new Date().toLocaleString('en-PH', { timeZone: env.timezone })}`, 40, 110, { align: 'right', width: doc.page.width - 80 });
  doc.moveDown(2);
}

/** Render a report (columns/rows/summary) as a paginated table PDF. */
function reportPdf(report, hotelName = 'StayEase') {
  const landscape = report.columns.length > 6;
  return pdfBuffer((doc) => {
    header(doc, hotelName, report.title, report.subtitle);
    const left = 40;
    const width = doc.page.width - 80;
    let y = 135;

    if (report.summary?.length) {
      const boxW = Math.min(150, width / Math.min(report.summary.length, 5));
      report.summary.slice(0, 5).forEach((s, i) => {
        const x = left + i * (boxW + 6);
        doc.roundedRect(x, y, boxW, 40, 4).fill('#F7F4EF');
        doc.fillColor(GRAY).font('Helvetica').fontSize(7).text(s.label.toUpperCase(), x + 8, y + 7, { width: boxW - 16 });
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(fmt(s.value, s.type), x + 8, y + 20, { width: boxW - 16 });
      });
      y += 54;
    }

    const cols = report.columns;
    const weights = cols.map((c) => (['text'].includes(c.type) ? 1.6 : c.type === 'datetime' ? 1.4 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / total) * width);
    const rowH = 18;
    const drawHead = () => {
      doc.rect(left, y, width, rowH).fill(NAVY);
      let x = left;
      cols.forEach((c, i) => {
        doc.fillColor('#fff').font('Helvetica-Bold').fontSize(7.5).text(c.label, x + 4, y + 5, { width: widths[i] - 8, align: ['money', 'number', 'percent'].includes(c.type) ? 'right' : 'left', ellipsis: true, lineBreak: false });
        x += widths[i];
      });
      y += rowH;
    };
    drawHead();
    if (!report.rows.length) doc.fillColor(GRAY).font('Helvetica-Oblique').fontSize(9).text('No records for the selected period.', left, y + 8);
    report.rows.forEach((row, ri) => {
      if (y + rowH > doc.page.height - 50) { doc.addPage(); y = 40; drawHead(); }
      if (ri % 2 === 0) doc.rect(left, y, width, rowH).fill('#FAFAF8');
      let x = left;
      cols.forEach((c, i) => {
        doc.fillColor('#30343B').font('Helvetica').fontSize(7.5).text(fmt(row[c.key], c.type), x + 4, y + 5, { width: widths[i] - 8, align: ['money', 'number', 'percent'].includes(c.type) ? 'right' : 'left', ellipsis: true, lineBreak: false });
        x += widths[i];
      });
      y += rowH;
    });
  }, { layout: landscape ? 'landscape' : 'portrait', bufferPages: true });
}

async function reportXlsx(report, hotelName = 'StayEase') {
  const wb = new ExcelJS.Workbook();
  wb.creator = hotelName;
  wb.created = new Date();
  const ws = wb.addWorksheet(report.title.slice(0, 31));
  ws.addRow([`${hotelName} — ${report.title}`]).font = { bold: true, size: 14, color: { argb: 'FF172B3A' } };
  ws.addRow([report.subtitle || '']).font = { italic: true, color: { argb: 'FF6B7280' } };
  ws.addRow([]);
  if (report.summary?.length) {
    for (const s of report.summary) {
      const r = ws.addRow([s.label, s.type === 'money' ? Number(s.value) : s.value]);
      r.getCell(1).font = { bold: true };
      if (s.type === 'money') r.getCell(2).numFmt = '"₱"#,##0.00';
      if (s.type === 'percent') r.getCell(2).numFmt = '0.0"%"';
    }
    ws.addRow([]);
  }
  const head = ws.addRow(report.columns.map((c) => c.label));
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF172B3A' } };
    cell.alignment = { vertical: 'middle' };
  });
  for (const row of report.rows) {
    const r = ws.addRow(report.columns.map((c) => {
      const v = row[c.key];
      if (c.type === 'datetime' && v) return new Date(v);
      if (['money', 'number', 'percent'].includes(c.type)) return v === '' || v === null ? null : Number(v);
      return c.type === 'status' && v ? String(v).replace(/_/g, ' ') : v;
    }));
    report.columns.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      if (c.type === 'money') cell.numFmt = '"₱"#,##0.00';
      if (c.type === 'percent') cell.numFmt = '0.0"%"';
      if (c.type === 'datetime') cell.numFmt = 'yyyy-mm-dd hh:mm';
    });
  }
  report.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.type === 'text' ? 26 : c.type === 'datetime' ? 18 : 14; });
  ws.getColumn(1).width = Math.max(ws.getColumn(1).width, 24);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { reportPdf, reportXlsx, pdfBuffer, fmt, fmtMoney, NAVY, GOLD, GRAY };
