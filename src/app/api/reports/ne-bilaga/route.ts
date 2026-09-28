import { NextResponse } from 'next/server'
import { generateNEDeclaration } from '@/lib/reports/ne-bilaga/ne-engine'
import {
  generateNESRUSubmission,
  getZipFilename,
  BLANKETTER_FILENAME,
} from '@/lib/reports/ne-bilaga/sru-generator'
import { withRouteContext } from '@/lib/api/with-route-context'
import { errorResponseFromCode } from '@/lib/errors/get-structured-error'
import { encodeISO88591 } from '@/lib/reports/sru-encoding'
import JSZip from 'jszip'
import { getErrorMessage as getUserErrorMessage } from '@/lib/errors/get-error-message'

/**
 * GET /api/reports/ne-bilaga
 *
 * Query parameters:
 *   period_id: fiscal period id (required)
 *   format:    'json' (default), 'sru' for the single blanketter.sru that Skatteverket's
 *              e-tjänst Inkomstdeklaration 1 imports at the NE bilaga, or 'sru-zip' for
 *              the INFO.SRU + BLANKETTER.SRU archive used by the e-tjänst Filöverföring.
 */
export const GET = withRouteContext(
  'report.ne_bilaga',
  async (request, ctx) => {
    const { supabase, companyId, log, requestId } = ctx

    const { searchParams } = new URL(request.url)
    const periodId = searchParams.get('period_id')
    const format = searchParams.get('format') || 'json'

    if (!periodId) {
      return errorResponseFromCode('REPORT_PERIOD_REQUIRED', log, { requestId })
    }

    const opLog = log.child({ periodId, format })

    try {
      const declaration = await generateNEDeclaration(supabase, companyId!, periodId)

      if (format === 'sru' || format === 'sru-zip') {
        const submission = generateNESRUSubmission(declaration)

        // Skatteverket requires ISO 8859-1 (Latin-1); UTF-8 mojibakes å/ä/ö and is rejected.
        const infoBytes = encodeISO88591(submission.infoSru)
        const blanketterBytes = encodeISO88591(submission.blanketterSru)

        if (format === 'sru') {
          // The NE import in Inkomstdeklaration 1 takes blanketter.sru alone; the zip
          // was rejected there ("Filen ... innehåller fel", 2026-09-10).
          return new NextResponse(blanketterBytes, {
            status: 200,
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Disposition': `attachment; filename="${BLANKETTER_FILENAME}"`,
              'X-Request-Id': requestId,
            },
          })
        }

        const zip = new JSZip()
        zip.file('INFO.SRU', infoBytes)
        zip.file('BLANKETTER.SRU', blanketterBytes)

        const zipArrayBuffer = await zip.generateAsync({ type: 'arraybuffer' })
        const filename = getZipFilename(declaration)

        return new NextResponse(zipArrayBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'X-Request-Id': requestId,
          },
        })
      }

      return NextResponse.json({ data: declaration })
    } catch (err) {
      opLog.error('ne-bilaga declaration generation failed', err as Error)
      return errorResponseFromCode('TAX_DECL_GENERATION_FAILED', opLog, {
        requestId,
        details: { reason: err instanceof Error ? getUserErrorMessage(err) : 'unknown' },
      })
    }
  }, {
    requireCompleteLedger: (request) => {
      const format = new URL(request.url).searchParams.get('format')
      return format === 'sru' || format === 'sru-zip'
    },
  })
