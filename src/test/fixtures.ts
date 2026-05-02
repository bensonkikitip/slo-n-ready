/**
 * Fixture CSV strings for Maestro E2E tests.
 *
 * Exposed only in __DEV__ builds. The import screen renders "Load …" buttons
 * that feed these strings through the real parse pipeline so tests never need
 * a document picker (which Maestro cannot drive for arbitrary file types).
 *
 * Column format matches citi_cc_v1: Status, Date, Description, Debit, Credit, Member Name
 */

export const SAMPLE_ONBOARDING_CSV = [
  'Status,Date,Description,Debit,Credit,Member Name',
  'Cleared,02/15/2026,"COSTCO WHSE #0474 GOLETA CA",62.48,,TEST USER',
  'Cleared,02/14/2026,"STARBUCKS #12345 SANTA BARBARA CA",6.75,,TEST USER',
  'Cleared,02/14/2026,"ARCO #42448 GOLETA CA",55.00,,TEST USER',
  'Cleared,02/13/2026,"AMAZON.COM*AB1CD2EF3 AMZN.COM/BILL WA",24.99,,TEST USER',
  'Cleared,02/12/2026,"NETFLIX.COM LOS GATOS CA",15.49,,TEST USER',
  'Cleared,02/11/2026,"ONLINE PAYMENT, THANK YOU",,500.00,TEST USER',
  'Pending,02/10/2026,"TRADER JOE\'S #123 GOLETA CA",38.22,,TEST USER',
].join('\n');

export const SAMPLE_IMPORT_CSV = [
  'Status,Date,Description,Debit,Credit,Member Name',
  'Cleared,03/15/2026,"COSTCO WHSE #0474 GOLETA CA",89.43,,TEST USER',
  'Cleared,03/14/2026,"STARBUCKS #12345 SANTA BARBARA CA",7.25,,TEST USER',
  'Cleared,03/14/2026,"JACK IN THE BOX #0159 SANTA BARBARA CA",9.87,,TEST USER',
  'Cleared,03/13/2026,"ARCO #42448 GOLETA CA",62.00,,TEST USER',
  'Cleared,03/13/2026,"SPOTIFY 877-778-1161 NY",16.99,,TEST USER',
  'Cleared,03/12/2026,"AMAZON MKTPL*XY12Z AMZN.COM/BILL WA",34.99,,TEST USER',
  'Cleared,03/12/2026,"ALBERTSONS #0354 GOLETA CA",27.11,,TEST USER',
  'Cleared,03/11/2026,"LYFT *RIDE MON 7PM LYFT.COM CA",18.50,,TEST USER',
  'Cleared,03/10/2026,"NETFLIX.COM LOS GATOS CA",15.49,,TEST USER',
  'Cleared,03/10/2026,"ONLINE PAYMENT, THANK YOU",,750.00,TEST USER',
  'Pending,03/09/2026,"TST* LOCAL CAFE SANTA BARBARA CA",14.30,,TEST USER',
  'Pending,03/08/2026,"SPROUTS FARMERS MKT GOLETA CA",41.75,,TEST USER',
].join('\n');
