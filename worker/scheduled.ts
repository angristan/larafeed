export type ScheduledSubsystem = () => Promise<void>;

export const runScheduledSubsystems = async (
    subsystems: readonly ScheduledSubsystem[],
): Promise<void> => {
    const results = await Promise.allSettled(
        subsystems.map((subsystem) => Promise.resolve().then(subsystem)),
    );
    const failures = results
        .filter(
            (result): result is PromiseRejectedResult =>
                result.status === 'rejected',
        )
        .map((result) => result.reason);

    if (failures.length > 0) {
        throw new AggregateError(failures, 'Scheduled subsystems failed');
    }
};
