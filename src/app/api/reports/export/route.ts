import { NextRequest, NextResponse } from 'next/server';
import { getShopSession } from '@/lib/session';
import { generatePdfReport } from '@/lib/pdf-generator';
import { PageMetrics, DateRange } from '@/types';

export async function POST(request: NextRequest) {
  const session = await getShopSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const body: {
      pages: PageMetrics[];
      dateRange: DateRange;
    } = await request.json();

    const { pages, dateRange } = body;

    if (!pages || pages.length === 0) {
      return NextResponse.json({ error: 'No data to export' }, { status: 400 });
    }

    const pdfBuffer = generatePdfReport(pages, dateRange);

    const fileName = `puplabs-analytics-${dateRange.start}-to-${dateRange.end}.pdf`;

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error('PDF export error:', error);
    return NextResponse.json(
      { error: 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}
