// Official booking receipt / confirmation PDF.
const env = require('../config/env');
const { pdfBuffer, fmtMoney, NAVY, GOLD, GRAY } = require('./export.service');
const { formatDate } = require('../utils/dates');

const dt = (d) => (d ? new Date(d).toLocaleString('en-PH', { timeZone: env.timezone, dateStyle: 'medium', timeStyle: 'short' }) : '—');
const longDate = (d) => new Date(`${formatDate(d)}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** @param booking raw Prisma booking with booking.service `include` */
function bookingReceipt(booking, settings) {
  return pdfBuffer((doc) => {
    const W = doc.page.width;
    doc.rect(0, 0, W, 96).fill(NAVY);
    doc.fillColor('#fff').font('Times-Roman').fontSize(24).text(settings.hotelName, 40, 28);
    doc.fillColor(GOLD).font('Helvetica').fontSize(8.5).text([settings.address, settings.contactNumber, settings.email].filter(Boolean).join('  ·  '), 40, 60, { width: W - 80 });

    const paid = Number(booking.amountPaid) >= Number(booking.totalAmount) && Number(booking.totalAmount) > 0;
    const title = paid ? 'OFFICIAL RECEIPT' : 'BOOKING CONFIRMATION';
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(14).text(title, 40, 120);
    doc.fillColor(GRAY).font('Helvetica').fontSize(9).text(`Issued ${dt(new Date())}`, 40, 138);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(18).text(booking.bookingReference, 40, 118, { align: 'right', width: W - 80 });
    doc.fillColor(GRAY).font('Helvetica').fontSize(8).text(`STATUS: ${booking.bookingStatus.replace(/_/g, ' ')}  ·  PAYMENT: ${booking.paymentStatus.replace(/_/g, ' ')}`, 40, 140, { align: 'right', width: W - 80 });

    let y = 170;
    const kv = (label, value, x, w) => {
      doc.fillColor(GRAY).font('Helvetica').fontSize(7.5).text(label.toUpperCase(), x, y, { width: w });
      doc.fillColor('#30343B').font('Helvetica').fontSize(10).text(value || '—', x, y + 11, { width: w });
    };
    const colW = (W - 80) / 3;
    kv('Guest', `${booking.guestFirstName} ${booking.guestLastName}`, 40, colW);
    kv('Email', booking.guestEmail, 40 + colW, colW);
    kv('Phone', booking.guestPhone, 40 + colW * 2, colW);
    y += 38;
    kv('Check-in', `${longDate(booking.checkIn)}\nfrom ${settings.checkInTime}`, 40, colW);
    kv('Check-out', `${longDate(booking.checkOut)}\nuntil ${settings.checkOutTime}`, 40 + colW, colW);
    kv('Guests', `${booking.adults} adult(s)${booking.children ? `, ${booking.children} child(ren)` : ''}\n${booking.nights} night(s)`, 40 + colW * 2, colW);
    y += 52;

    // Room lines
    doc.rect(40, y, W - 80, 20).fill('#F7F4EF');
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8.5);
    doc.text('ROOM', 48, y + 6); doc.text('ROOM NO.', 270, y + 6); doc.text('RATE / NIGHT', 340, y + 6, { width: 90, align: 'right' }); doc.text('AMOUNT', 440, y + 6, { width: W - 488, align: 'right' });
    y += 26;
    for (const r of booking.rooms) {
      doc.fillColor('#30343B').font('Helvetica').fontSize(9.5);
      doc.text(r.roomType.name, 48, y, { width: 210 });
      doc.text(r.room.roomNumber, 270, y);
      doc.text(fmtMoney(r.nightlyRate), 340, y, { width: 90, align: 'right' });
      doc.text(fmtMoney(Number(r.nightlyRate) * booking.nights), 440, y, { width: W - 488, align: 'right' });
      y += 18;
    }
    y += 6;
    doc.moveTo(300, y).lineTo(W - 40, y).strokeColor('#E9EAEC').stroke();
    y += 8;
    const line = (label, value, bold) => {
      doc.fillColor(bold ? NAVY : '#30343B').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5);
      doc.text(label, 300, y, { width: 140 }); doc.text(value, 440, y, { width: W - 480, align: 'right' });
      y += bold ? 20 : 16;
    };
    line('Subtotal', fmtMoney(booking.subtotal));
    if (Number(booking.discount) > 0) line(`Discount${booking.couponCode ? ` (${booking.couponCode})` : ''}`, `– ${fmtMoney(booking.discount)}`);
    line(`Taxes (${Number(settings.taxRate)}%)`, fmtMoney(booking.taxes));
    line('Total', fmtMoney(booking.totalAmount), true);
    line('Amount paid', fmtMoney(booking.amountPaid));
    if (Number(booking.amountRefunded) > 0) line('Refunded', `– ${fmtMoney(booking.amountRefunded)}`);
    line('Balance due', fmtMoney(Math.max(0, Number(booking.totalAmount) - Number(booking.amountPaid))), true);

    // Payments
    const pays = booking.payments.filter((p) => p.paymentStatus !== 'PENDING');
    if (pays.length) {
      y += 10;
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10).text('Payment history', 40, y);
      y += 16;
      for (const p of pays) {
        doc.fillColor('#30343B').font('Helvetica').fontSize(8.5)
          .text(`${dt(p.paidAt || p.createdAt)}   ${p.paymentReference}   ${p.paymentMethod || p.provider}   ${p.paymentStatus.replace(/_/g, ' ')}`, 48, y, { width: 380 });
        doc.text(fmtMoney(p.amount), 440, y, { width: W - 480, align: 'right' });
        y += 14;
        for (const r of p.refunds.filter((x) => x.refundStatus === 'SUCCEEDED')) {
          doc.fillColor(GRAY).text(`   Refund ${dt(r.updatedAt)} — ${r.reason || ''}`, 48, y, { width: 380 });
          doc.text(`– ${fmtMoney(r.amount)}`, 440, y, { width: W - 480, align: 'right' });
          y += 14;
        }
      }
    }

    const foot = doc.page.height - 110;
    doc.moveTo(40, foot).lineTo(W - 40, foot).strokeColor('#E9EAEC').stroke();
    doc.fillColor(GRAY).font('Helvetica').fontSize(7.5).text(
      `${booking.paymentMethod === 'PAY_AT_HOTEL' && !paid ? 'Payment will be collected at the front desk. ' : ''}Please present this document and a valid government ID at check-in. ${settings.cancellationPolicy ? `Cancellation policy: ${settings.cancellationPolicy}` : ''}`,
      40, foot + 10, { width: W - 80 },
    );
    doc.fillColor(GOLD).fontSize(8).text(`Thank you for choosing ${settings.hotelName}.`, 40, foot + 52, { width: W - 80, align: 'center' });
  });
}

module.exports = { bookingReceipt };
