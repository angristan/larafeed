export type ScheduledSubsystem = () => Promise<void>;

export const runScheduledSubsystems = async (
    subsystems: readonly ScheduledSubsystem[],
): Promise<void> => {
    const failures: unknown[] = [];
    for (const subsystem of subsystems) {
        try {
            // D1 serializes writes. Run cron subsystems in order so their
            // recovery and dispatch transactions do not compete for D1.
            await subsystem();
        } catch (error) {
            failures.push(error);
        }
    }

    if (failures.length > 0) {
        throw new AggregateError(failures, 'Scheduled subsystems failed');
    }
};
