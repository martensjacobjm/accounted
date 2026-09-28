import { describe, it, expect } from 'vitest'
import { NE_ACCOUNT_MAPPINGS, isResultAccount } from '../ne-engine'

/**
 * Helper to check if an account falls into a specific ruta
 */
function findRutaForAccount(accountNumber: string): string | null {
  for (const mapping of NE_ACCOUNT_MAPPINGS) {
    for (const range of mapping.accountRanges) {
      if (accountNumber >= range.start && accountNumber <= range.end) {
        if (range.exclude && range.exclude.includes(accountNumber)) {
          continue
        }
        return mapping.ruta
      }
    }
  }
  return null
}

describe('NE Account Mappings', () => {
  describe('R1 - Försäljning med moms', () => {
    it('includes standard revenue accounts 3001-3003', () => {
      expect(findRutaForAccount('3001')).toBe('R1')
      expect(findRutaForAccount('3002')).toBe('R1')
      expect(findRutaForAccount('3003')).toBe('R1')
    })

    it('excludes 3100 (momsfria intäkter)', () => {
      expect(findRutaForAccount('3100')).not.toBe('R1')
    })

    it('includes 3500 (Fakturerade kostnader)', () => {
      expect(findRutaForAccount('3500')).toBe('R1')
    })

    it('includes 3500-3599 range', () => {
      expect(findRutaForAccount('3510')).toBe('R1')
      expect(findRutaForAccount('3599')).toBe('R1')
    })

    it('includes 3700-3799 (Lämnade rabatter)', () => {
      expect(findRutaForAccount('3700')).toBe('R1')
      expect(findRutaForAccount('3731')).toBe('R1')
      expect(findRutaForAccount('3799')).toBe('R1')
    })
  })

  describe('R2 - Momsfria intäkter', () => {
    it('includes 3100', () => {
      expect(findRutaForAccount('3100')).toBe('R2')
    })

    it('includes 3900 (Övriga rörelseintäkter)', () => {
      expect(findRutaForAccount('3900')).toBe('R2')
    })

    it('includes 3910 (Hyresintäkter)', () => {
      expect(findRutaForAccount('3910')).toBe('R2')
    })

    it('includes 3920 (Provisionsintäkter)', () => {
      expect(findRutaForAccount('3920')).toBe('R2')
    })

    it('includes 3950 (Återvunna kundfordringar)', () => {
      expect(findRutaForAccount('3950')).toBe('R2')
    })

    it('includes 3960 (Valutakursvinster)', () => {
      expect(findRutaForAccount('3960')).toBe('R2')
    })

    it('includes 3970-3980 range', () => {
      expect(findRutaForAccount('3970')).toBe('R2')
      expect(findRutaForAccount('3980')).toBe('R2')
    })

    it('includes 3981-3999 range', () => {
      expect(findRutaForAccount('3981')).toBe('R2')
      expect(findRutaForAccount('3990')).toBe('R2')
      expect(findRutaForAccount('3999')).toBe('R2')
    })
  })

  describe('accounts are not silently dropped', () => {
    it('3500 is mapped (not dropped)', () => {
      expect(findRutaForAccount('3500')).not.toBeNull()
    })

    it('3700 is mapped (not dropped)', () => {
      expect(findRutaForAccount('3700')).not.toBeNull()
    })

    it('3910 is mapped (not dropped)', () => {
      expect(findRutaForAccount('3910')).not.toBeNull()
    })

    it('3960 is mapped (not dropped)', () => {
      expect(findRutaForAccount('3960')).not.toBeNull()
    })

    it('3990 is mapped (not dropped)', () => {
      expect(findRutaForAccount('3990')).not.toBeNull()
    })
  })

  describe('R6 - Övriga externa kostnader covers all of class 5-6 and 79', () => {
    // 6991-6999 are sub-accounts of 6990 and 79xx are övriga rörelsekostnader.
    // A range of 5000-6990 + 7970 dropped 6991 (inkassoavgifter) and 7960
    // (kursförluster) silently, so R11 came out 2 052 kr too high for 2024.
    it.each(['5000', '5460', '6990', '6991', '6993', '6999', '7900', '7960', '7970', '7973', '7990', '7999'])(
      '%s is in R6',
      (account) => {
        expect(findRutaForAccount(account)).toBe('R6')
      },
    )

    it('neighbouring classes keep their own rutor', () => {
      expect(findRutaForAccount('4990')).toBe('R5')
      expect(findRutaForAccount('7000')).toBe('R7')
      expect(findRutaForAccount('7699')).toBe('R7')
      expect(findRutaForAccount('7700')).toBe('R10')
      expect(findRutaForAccount('7820')).toBe('R9')
      expect(findRutaForAccount('7899')).toBe('R10')
      expect(findRutaForAccount('8410')).toBe('R8')
    })
  })

  describe('isResultAccount', () => {
    it('covers class 3-8 up to 8899', () => {
      expect(isResultAccount('3000')).toBe(true)
      expect(isResultAccount('7960')).toBe(true)
      expect(isResultAccount('8899')).toBe(true)
    })

    it('leaves balance accounts and 89xx (skatt, årets resultat) out', () => {
      expect(isResultAccount('2999')).toBe(false)
      expect(isResultAccount('8910')).toBe(false)
      expect(isResultAccount('8999')).toBe(false)
    })
  })

  describe('no overlap between R1 and R2', () => {
    it('3100 is in R2 not R1', () => {
      expect(findRutaForAccount('3100')).toBe('R2')
    })

    it('3001 is in R1 not R2', () => {
      expect(findRutaForAccount('3001')).toBe('R1')
    })

    it('3900 is in R2 not R1', () => {
      expect(findRutaForAccount('3900')).toBe('R2')
    })
  })
})
