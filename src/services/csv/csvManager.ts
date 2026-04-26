import type { CsvFileMetadata } from "../../models/types";
import {
  listScopedCsvFiles,
  type CsvOwnerScope,
} from "./csvStorage";

export const listCsvFiles = async (
  scope: CsvOwnerScope,
): Promise<CsvFileMetadata[]> => {
  return listScopedCsvFiles(scope);
};
