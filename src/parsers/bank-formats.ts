import { AccountType, CsvFormat } from '../db/queries';

export interface BankFormatEntry {
  label:   string;
  value:   CsvFormat;
  forType: AccountType;
}

/**
 * Known bank statement formats.
 * Determines which PDF parser (or CSV column config) is applied on import.
 * Used in both the Edit Account screen and the Add Account / onboarding flow.
 */
export const CSV_FORMATS: BankFormatEntry[] = [
  { label: 'Bank of America – Checking',    value: 'boa_checking_v1',  forType: 'checking' },
  { label: 'Bank of America – Savings',     value: 'boa_savings_v1',   forType: 'checking' },
  { label: 'Bank of America – Credit Card', value: 'boa_cc_v1',        forType: 'credit_card' },
  { label: 'Axos – Checking',               value: 'axos_checking_v1', forType: 'checking' },
  { label: 'Axos – Savings',                value: 'axos_savings_v1',  forType: 'checking' },
  { label: 'Chase – Credit Card',           value: 'chase_cc_v1',      forType: 'credit_card' },
  { label: 'Citi – Credit Card',            value: 'citi_cc_v1',       forType: 'credit_card' },
];
