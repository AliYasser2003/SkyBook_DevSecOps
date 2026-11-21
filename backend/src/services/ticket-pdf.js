
const PDFDocument = require('pdfkit');

function createTicketPdf(booking) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 45, bottom: 45, left: 45, right: 45 },
    info: {
      Title: `SkyBook E-Ticket - ${booking.reference}`,
      Author: 'SkyBook Airways'
    }
  });

  const navy = '#10243A';
  const blue = '#246BCE';
  const muted = '#64748B';

  const passengers = booking.passengers || [];
  const flight = booking.flight;

  doc.rect(0, 0, 595.28, 125).fill(navy);

  doc.fillColor('#FFFFFF')
    .fontSize(25)
    .font('Helvetica-Bold')
    .text('SKYBOOK', 45, 42);

  doc.fontSize(11)
    .font('Helvetica')
    .text('ELECTRONIC FLIGHT TICKET', 45, 78);

  doc.fontSize(10)
    .text('YOUR JOURNEY STARTS HERE', 390, 52, {
      width: 160,
      align: 'right'
    });

  doc.fillColor(navy)
    .fontSize(19)
    .font('Helvetica-Bold')
    .text('Booking confirmation', 45, 155);

  doc.fillColor(muted)
    .fontSize(10)
    .font('Helvetica')
    .text('Keep this document for your travel records.', 45, 183);

  doc.roundedRect(45, 215, 505, 75, 8)
    .fill('#EFF5FC');

  doc.fillColor(muted)
    .fontSize(9)
    .text('BOOKING REFERENCE', 65, 233);

  doc.fillColor(navy)
    .fontSize(20)
    .font('Helvetica-Bold')
    .text(booking.reference, 65, 251);

  doc.fillColor(muted)
    .fontSize(9)
    .text('STATUS', 390, 233);

  doc.fillColor('#15803D')
    .fontSize(12)
    .font('Helvetica-Bold')
    .text('CONFIRMED', 390, 251);

  doc.fillColor(navy)
    .fontSize(14)
    .text('FLIGHT INFORMATION', 45, 320);

  doc.moveTo(45, 345)
    .lineTo(550, 345)
    .strokeColor('#DCE4EE')
    .stroke();

  const flightFields = [
    ['FLIGHT NUMBER', flight.flightNumber],
    ['AIRLINE', flight.airline],
    ['FROM', flight.origin],
    ['TO', flight.destination],
    ['DEPARTURE', flight.departureAt],
    ['ARRIVAL', flight.arrivalAt]
  ];

  let y = 365;

  for (let i = 0; i < flightFields.length; i += 2) {
    for (let j = 0; j < 2; j++) {
      const field = flightFields[i + j];
      const x = j === 0 ? 45 : 310;

      doc.fillColor(muted)
        .fontSize(8)
        .font('Helvetica')
        .text(field[0], x, y);

      doc.fillColor(navy)
        .fontSize(11)
        .font('Helvetica-Bold')
        .text(String(field[1] || 'Not available'), x, y + 16, {
          width: 230
        });
    }

    y += 55;
  }

  doc.fillColor(navy)
    .fontSize(14)
    .text('PASSENGERS', 45, 535);

  doc.moveTo(45, 558)
    .lineTo(550, 598)
    .strokeColor('#DCE4EE')
    .stroke();

  y = 570;

  passengers.forEach((passenger, index) => {
    doc.fillColor(navy)
      .fontSize(9)
      .font('Helvetica')
      .text(
        `${index + 1}. ${passenger.fullName}    Seat: ${passenger.seatNumber || 'Not assigned'}`,
        50,
        y,
        { width: 490 }
      );

    y += 16;
  });

  y = Math.max(y + 12, 730);

  doc.roundedRect(45, y, 505, 65, 8)
    .fill('#EFF5FC');

  doc.fillColor(muted)
    .fontSize(9)
    .text('TOTAL PAID', 65, y + 15);

  doc.fillColor(blue)
    .fontSize(17)
    .font('Helvetica-Bold')
    .text(
      `${booking.currency} ${Number(booking.totalAmount).toFixed(2)}`,
      65,
      y + 32
    );

  doc.fillColor(muted)
    .fontSize(8)
    .font('Helvetica')
    .text(
      'This ticket confirms your booking. Please check airline requirements before travel.',
      45,
      y + 78,
      { width: 505, align: 'center' }
    );

  doc.end();

  return doc;
}

module.exports = { createTicketPdf };

