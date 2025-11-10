import type { ScanStatus } from "../models/types";

export const ProgressIndicator = ({ status }: { status: ScanStatus | null }) => {
  if (!status || status.totalChannels === 0) {
    return (
      <>
        <p className="progress-title">Starting scan…</p>
        <div className="progress-bar">
          <div className="progress-bar__fill progress-bar__fill--loop" />
        </div>
      </>
    );
  }

  if (!status.inProgress) {
    return (
      <>
        <p className="progress-title">Preparing scan…</p>
        <div className="progress-bar">
          <div className="progress-bar__fill progress-bar__fill--loop" />
        </div>
      </>
    );
  }

  const hasMemberTotals = status.totalMembers > 0;
  let percent: number;

  if (hasMemberTotals) {
    const memberRatio = Math.min(
      status.totalMembers > 0 ? status.processedMembers / status.totalMembers : 0,
      1,
    );
    percent = Math.round(memberRatio * 100);
  } else {
    const totalChannels = Math.max(status.totalChannels, 1);
    const processedChannels = Math.max(
      Math.min(status.processedChannels, status.totalChannels),
      0,
    );
    const hasActiveChannel = Boolean(status.currentChannel);
    const inFlightDelta =
      hasActiveChannel && status.currentIndex > processedChannels
        ? Math.min(status.currentIndex - processedChannels, 1)
        : 0;
    const channelRatio = Math.min(
      (processedChannels + inFlightDelta) / totalChannels,
      1,
    );
    percent = Math.round(channelRatio * 100);
  }

  const currentStep =
    status.totalChannels > 0
      ? Math.min(
          Math.max(status.currentIndex, status.processedChannels + 1),
          status.totalChannels,
        )
      : 0;

  const channelLabel = status.currentChannel ? `Scanning #${status.currentChannel}` : "Scanning…";
  const stepLabel = hasMemberTotals
    ? `${status.processedMembers}/${status.totalMembers} members evaluated`
    : status.totalChannels > 0
      ? `${currentStep} of ${status.totalChannels}`
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
    </>
  );
};
