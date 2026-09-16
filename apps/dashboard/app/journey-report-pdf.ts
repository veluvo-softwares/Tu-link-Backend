import type { RouteMap } from './journey-route-map';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  durationGroup,
  durationSeconds,
  formatDuration,
  reportDate,
  type JourneyReport,
} from './journey-reports';

export async function buildJourneyPdf(
  journey: JourneyReport,
  generatedAt = new Date(),
  routeMap?: RouteMap,
) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(
    await readFile(path.join(process.cwd(), 'app/fonts/Inter-Variable.ttf')),
    { subset: false },
  );
  const teal = rgb(7 / 255, 82 / 255, 97 / 255);
  const orange = rgb(243 / 255, 93 / 255, 50 / 255);
  const ink = rgb(0.1, 0.15, 0.16);
  const muted = rgb(0.36, 0.42, 0.43);
  const supported = new Set(font.getCharacterSet());
  const safe = (text: string) =>
    Array.from(text.replace(/[\u0000-\u001f\u007f]/g, ' '))
      .map((c) => (supported.has(c.codePointAt(0)!) ? c : '?'))
      .join('');
  let page = doc.addPage([595.28, 841.89]);
  let y = 0;
  const header = () => {
    page.drawRectangle({ x: 0, y: 747, width: 596, height: 95, color: teal });
    page.drawText('Tu-Link', {
      x: 42,
      y: 796,
      size: 24,
      font,
      color: rgb(1, 1, 1),
    });
    page.drawText('JOURNEY REPORT', {
      x: 42,
      y: 769,
      size: 11,
      font,
      color: rgb(1, 1, 1),
    });
    page.drawRectangle({ x: 42, y: 731, width: 52, height: 4, color: orange });
    y = 708;
  };
  const newPage = () => {
    page = doc.addPage([595.28, 841.89]);
    header();
  };
  const line = (value: string, size = 11, color = ink) => {
    if (y < 78) newPage();
    page.drawText(value, { x: 42, y, size, font, color });
    y -= size * 1.5;
  };
  // Measure glyph widths, including unbroken IDs and long destination names.
  const text = (value: string, size = 11, color = ink) => {
    let current = '';
    for (const word of safe(value).split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= 510) {
        current = candidate;
        continue;
      }
      if (current) line(current, size, color);
      current = '';
      for (const char of word) {
        if (font.widthOfTextAtSize(current + char, size) > 510) {
          line(current, size, color);
          current = '';
        }
        current += char;
      }
    }
    if (current) line(current, size, color);
  };
  const field = (label: string, value: string) => {
    if (y < 125) newPage();
    text(label.toUpperCase(), 9, muted);
    text(value);
    y -= 12;
  };
  header();
  text(journey.name, 21, teal);
  y -= 12;
  field('Journey ID', journey.id);
  field('Status', journey.status);
  field(
    'Destination',
    journey.destinationName ?? journey.destinationAddress ?? 'Not recorded',
  );
  if (journey.destinationName && journey.destinationAddress)
    field('Address', journey.destinationAddress);
  field('Recorded duration', formatDuration(durationSeconds(journey)));
  field('Duration group', durationGroup(journey));
  field('Created', reportDate(journey.createdAt));
  field('Scheduled start', reportDate(journey.scheduledFor));
  field('Actual start', reportDate(journey.startTime));
  field('Actual end', reportDate(journey.endTime));
  text(
    'Duration is based on recorded start and end times. Active and pending journeys do not yet have a final duration.',
    9,
    muted,
  );
  y -= 10;
  text(
    `Generated ${reportDate(generatedAt.toISOString())}. All times are East Africa Time (UTC+3).`,
    9,
    muted,
  );
  if (routeMap) {
    newPage();
    text('Journey route', 21, teal);
    y -= 12;
    text(journey.name, 12, teal);
    y -= 16;
    if (routeMap.png) {
      if (y < 380) newPage();
      const image = await doc.embedPng(routeMap.png);
      const height = (510 * image.height) / image.width;
      page.drawImage(image, { x: 42, y: y - height, width: 510, height });
      y -= height + 24;
    }
    text(routeMap.caption, 10, muted);
  }
  doc.getPages().forEach((p, index) => {
    p.drawLine({
      start: { x: 42, y: 51 },
      end: { x: 553, y: 51 },
      thickness: 0.5,
      color: muted,
    });
    p.drawText(`Tu-Link Operations  |  ${index + 1} / ${doc.getPageCount()}`, {
      x: 42,
      y: 33,
      size: 9,
      font,
      color: muted,
    });
  });
  doc.setTitle(`Journey report - ${safe(journey.name)}`);
  doc.setCreator('Tu-Link Operations');
  doc.setCreationDate(generatedAt);
  return doc.save();
}
