export type ScanCancellationController = {
  cancel: () => void;
  isCancelled: () => boolean;
};

export const createScanCancellationController =
  (): ScanCancellationController => {
    let cancelled = false;
    return {
      cancel() {
        cancelled = true;
      },
      isCancelled: () => cancelled,
    };
  };
