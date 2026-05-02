export type DateFormat  = 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
export type AmountStyle = 'signed' | 'debit_credit';

export interface ColumnConfig {
  dateColumn:          string;
  descriptionColumn:   string;
  dateFormat:          DateFormat;
  amountStyle:         AmountStyle;

  // amountStyle = 'signed': one column, already +/–
  signedAmountColumn?: string;
  headerContains?:     string; // skip preamble until a line containing this string

  // amountStyle = 'debit_credit': two columns; debit → negative, credit → positive
  debitColumn?:  string;
  creditColumn?: string;

  // Optional pending detection; omit = all transactions are cleared
  pendingColumn?: string;
  clearedValue?:  string;
}

export const DEFAULT_CONFIGS: Record<string, ColumnConfig> = {
  boa_checking_v1: {
    dateColumn:         'Date',
    descriptionColumn:  'Description',
    dateFormat:         'MM/DD/YYYY',
    amountStyle:        'signed',
    signedAmountColumn: 'Amount',
    headerContains:     'Date,Description,Amount',
  },
  citi_cc_v1: {
    dateColumn:       'Date',
    descriptionColumn:'Description',
    dateFormat:       'MM/DD/YYYY',
    amountStyle:      'debit_credit',
    debitColumn:      'Debit',
    creditColumn:     'Credit',
    pendingColumn:    'Status',
    clearedValue:     'Cleared',
  },
  // BoA savings accounts (Regular Savings, Adv SafeBalance Banking)
  // CSV columns: Date, Description, Amount, Running Bal.
  // Amount is already signed; Running Bal. is ignored.
  boa_savings_v1: {
    dateColumn:         'Date',
    descriptionColumn:  'Description',
    dateFormat:         'MM/DD/YYYY',
    amountStyle:        'signed',
    signedAmountColumn: 'Amount',
    headerContains:     'Date,Description,Amount',
  },
};
