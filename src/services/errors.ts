export class ScanCancelledError extends Error {
  constructor(message = "Scan cancelled by user.") {
    super(message);
    this.name = "ScanCancelledError";
  }
}
