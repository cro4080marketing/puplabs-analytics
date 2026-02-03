import jsPDF from 'jspdf';
import { PageMetrics, DateRange, AttributionMethod, TagFilter } from '@/types';

export function generatePdfReport(
  pages: PageMetrics[],
  dateRange: DateRange,
  attributionMethod: AttributionMethod,
  tagFilter?: TagFilter
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
  doc.text(`Attribution: ${formatAttributionMethod(attributionMethod)}`, 14, 34);
  if (tagFilter && tagFilter.tags.length > 0) {
    doc.text(`Tag Filter: ${tagFilter.tags.join(` ${tagFilter.logic} `)}`, 14, 40);
  }
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, tagFilter && tagFilter.tags.length > 0 ? 46 : 40);

  // Divider line
  const startY = tagFilter && tagFilter.tags.length > 0 ? 50 : 44;
  doc.setDrawColor(200, 200, 200);
  doc.line(14, startY, pageWidth - 14, startY);

  // Table
  const tableStartY = startY + 8;
  const metrics = ['URL', 'Sessions', 'Revenue', 'Rev/Visitor', 'Conv. Rate', 'AOV', 'Orders'];
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
  const bestWorst = findBestWorst(pages);

  // Table rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  let y = tableStartY + 14;

  pages.forEach((page, rowIndex) => {
    if (rowIndex % 2 === 0) {
      doc.setFillColor(250, 250, 250);
      doc.rect(14, y - 4, pageWidth - 28, 10, 'F');
    }

    x = 14;
    const values = [
      truncateUrl(page.url, 40),
      page.sessions.toLocaleString(),
      `$${page.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      `$${page.revenuePerVisitor.toFixed(2)}`,
      `${page.conversionRate.toFixed(2)}%`,
      `$${page.aov.toFixed(2)}`,
      page.orderCount.toLocaleString(),
    ];

    values.forEach((value, i) => {
      const metricKey = metrics[i];
      if (i > 0 && bestWorst.best[metricKey] === rowIndex) {
        doc.setTextColor(22, 163, 74); // green
      } else if (i > 0 && bestWorst.worst[metricKey] === rowIndex && pages.length > 1) {
        doc.setTextColor(220, 38, 38); // red
      } else {
        doc.setTextColor(60, 60, 60);
      }

      doc.text(value, x + 2, y + 2);
      x += colWidths[i];
    });

    y += 10;
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

function formatAttributionMethod(method: AttributionMethod): string {
  const labels: Record<AttributionMethod, string> = {
    landing_page: 'Landing Page',
    last_page: 'Last Page Before Checkout',
    referrer: 'Referrer',
    utm: 'UTM Parameters',
  };
  return labels[method];
}

function truncateUrl(url: string, maxLength: number): string {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength - 3) + '...';
}

function findBestWorst(pages: PageMetrics[]): {
  best: Record<string, number>;
  worst: Record<string, number>;
} {
  const best: Record<string, number> = {};
  const worst: Record<string, number> = {};

  if (pages.length < 2) return { best, worst };

  const metricKeys = [
    { key: 'Sessions', field: 'sessions' as keyof PageMetrics },
    { key: 'Revenue', field: 'totalRevenue' as keyof PageMetrics },
    { key: 'Rev/Visitor', field: 'revenuePerVisitor' as keyof PageMetrics },
    { key: 'Conv. Rate', field: 'conversionRate' as keyof PageMetrics },
    { key: 'AOV', field: 'aov' as keyof PageMetrics },
    { key: 'Orders', field: 'orderCount' as keyof PageMetrics },
  ];

  metricKeys.forEach(({ key, field }) => {
    let bestIdx = 0;
    let worstIdx = 0;

    pages.forEach((page, i) => {
      if ((page[field] as number) > (pages[bestIdx][field] as number)) bestIdx = i;
      if ((page[field] as number) < (pages[worstIdx][field] as number)) worstIdx = i;
    });

    if (bestIdx !== worstIdx) {
      best[key] = bestIdx;
      worst[key] = worstIdx;
    }
  });

  return { best, worst };
}
