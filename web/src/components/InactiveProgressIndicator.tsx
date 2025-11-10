import type { InactiveScanStatus } from "../models/types";

export const InactiveProgressIndicator = ({ status }: { status: InactiveScanStatus | null }) => {
  if (!status || status.totalChannels === 0) {
    return (
      <>
        <p className="progress-title">Preparing inactive scan…</p>
        <div className="progress-bar">
          <div className="progress-bar__fill progress-bar__fill--loop" />
        </div>
      </>
    );
  }

  if (!status.inProgress && !status.finishedAt) {
    return (
      <>
        <p className="progress-title">Starting inactive scan…</p>
        <div className="progress-bar">
          <div className="progress-bar__fill progress-bar__fill--loop" />
        </div>
      </>
    );
  }

  const totalChannels = Math.max(status.totalChannels, 1);
  const processed = Math.max(Math.min(status.processedChannels, totalChannels), 0);
  const hasActiveChannel = Boolean(status.currentChannel);
  const inFlightDelta =
    hasActiveChannel && status.currentIndex > processed
      ? Math.min(status.currentIndex - processed, 1)
      : 0;
  const ratio = Math.min((processed + inFlightDelta) / totalChannels, 1);
  const percent = Math.round(ratio * 100);
  const currentStep =
    status.totalChannels > 0
      ? Math.min(Math.max(status.currentIndex, processed + 1), status.totalChannels)
      : 0;

  const channelLabel = status.currentChannel ? `Scanning #${status.currentChannel}` : "Scanning inactive users…";
  const stepLabel =
    status.totalChannels > 0
      ? `${currentStep} of ${status.totalChannels} channels`
      : undefined;

  return (
    <>
      <p className="progress-title">
        {channelLabel}
        {stepLabel ? ` (${stepLabel})` : ""}
      </p>
      <div className="progress-bar">
        <div className="progress-bar__fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="progress-note">Messages inspected: {status.totalMessages.toLocaleString()}</p>
    </>
  );
};
