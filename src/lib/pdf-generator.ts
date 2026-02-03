import jsPDF from 'jspdf';
import { GroupMetrics, DateRange } from '@/types';

export function generatePdfReport(
  groups: GroupMetrics[],
  dateRange: DateRange
): ArrayBuffer {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('PupLabs Analytics Report', 14, 20);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(`Date Range: ${dateRange.start} to ${dateRange.end}`, 14, 28);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 34);

  // Divider line
  const startY = 38;
  doc.setDrawColor(200, 200, 200);
  doc.line(14, startY, pageWidth - 14, startY);

  // Table
  const tableStartY = startY + 8;
  const metrics = ['Group', 'Sessions', 'Revenue', 'Rev/Visitor', 'Conv. Rate', 'AOV', 'Orders'];
  const colWidths = [80, 28, 32, 32, 28, 28, 24];
  let x = 14;

  // Table header
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(60, 60, 60);
  doc.setFillColor(245, 245, 245);
  doc.rect(14, tableStartY - 4, pageWidth - 28, 10, 'F');

  metrics.forEach((metric, i) => {
    doc.text(metric, x + 2, tableStartY + 2);
    x += colWidths[i];
  });

  // Find best/worst for highlighting
  const bestWorst = findBestWorst(groups);

  // Table rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  let y = tableStartY + 14;

  groups.forEach((group, rowIndex) => {
    if (rowIndex % 2 === 0) {
      doc.setFillColor(250, 250, 250);
      doc.rect(14, y - 4, pageWidth - 28, 10, 'F');
    }

    x = 14;
    const displayName = truncateText(group.name, 40);

    const values = [
      displayName,
      group.sessions.toLocaleString(),
      `$${group.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      `$${group.revenuePerVisitor.toFixed(2)}`,
      `${group.conversionRate.toFixed(2)}%`,
      `$${group.aov.toFixed(2)}`,
      group.orderCount.toLocaleString(),
    ];

    values.forEach((value, i) => {
      const metricKey = metrics[i];
      if (i > 0 && bestWorst.best[metricKey] === rowIndex) {
        doc.setTextColor(22, 163, 74); // green
      } else if (i > 0 && bestWorst.worst[metricKey] === rowIndex && groups.length > 1) {
        doc.setTextColor(220, 38, 38); // red
      } else {
        doc.setTextColor(60, 60, 60);
      }

      doc.text(value, x + 2, y + 2);
      x += colWidths[i];
    });

    // Add URLs below group name
    doc.setFontSize(6);
    doc.setTextColor(150, 150, 150);
    const urlList = group.urls.map(u => truncateText(u, 60)).join(', ');
    doc.text(truncateText(urlList, 120), 16, y + 6);
    doc.setFontSize(8);

    y += 14;
  });

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('PupLabs Analytics', 14, doc.internal.pageSize.getHeight() - 10);
  doc.text(
    `Page 1 of 1`,
    pageWidth - 35,
    doc.internal.pageSize.getHeight() - 10
  );

  return doc.output('arraybuffer');
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

function findBestWorst(groups: GroupMetrics[]): {
  best: Record<string, number>;
  worst: Record<string, number>;
} {
  const best: Record<string, number> = {};
  const worst: Record<string, number> = {};

  if (groups.length < 2) return { best, worst };

  const metricKeys = [
    { key: 'Sessions', field: 'sessions' as keyof GroupMetrics },
    { key: 'Revenue', field: 'totalRevenue' as keyof GroupMetrics },
    { key: 'Rev/Visitor', field: 'revenuePerVisitor' as keyof GroupMetrics },
    { key: 'Conv. Rate', field: 'conversionRate' as keyof GroupMetrics },
    { key: 'AOV', field: 'aov' as keyof GroupMetrics },
    { key: 'Orders', field: 'orderCount' as keyof GroupMetrics },
  ];

  metricKeys.forEach(({ key, field }) => {
    let bestIdx = 0;
    let worstIdx = 0;

    groups.forEach((group, i) => {
      if ((group[field] as number) > (groups[bestIdx][field] as number)) bestIdx = i;
      if ((group[field] as number) < (groups[worstIdx][field] as number)) worstIdx = i;
    });

    if (bestIdx !== worstIdx) {
      best[key] = bestIdx;
      worst[key] = worstIdx;
    }
  });

  return { best, worst };
}
