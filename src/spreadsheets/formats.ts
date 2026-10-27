export const isSpreadsheet = (path: string) =>
  /\.(?:csv|xls|xlsx)$/i.test(path);
export const isBinaryWorkbook = (path: string) => /\.(?:xls|xlsx)$/i.test(path);
