export { default } from '../Subscriptions';export { default } from '../Subscriptions';import AppShellLayout from '@/Layouts/AppShellLayout/AppShellLayout';


import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { PageProps } from '@/types';
                                            <Table.Tbody>
                                                {selectedFeed.refreshes.length === 0 && (
                                                    <Table.Tr>
                                                        <Table.Td colSpan={4}>
                                                            <Text size="sm" c="dimmed">
                                                                No refresh attempts recorded yet.
                                                            </Text>
                                                        </Table.Td>
                                                    </Table.Tr>
                                                )}

                                                {selectedFeed.refreshes.map((refresh) => (
                                                    <Table.Tr key={refresh.id}>
                                                        <Table.Td>{formatAbsolute(refresh.refreshed_at)}</Table.Td>
                                                        <Table.Td>
                                                            <Badge
                                                                color={refresh.was_successful ? 'green' : 'red'}
                                                                variant="light"
                                                            >
                                                                {refresh.was_successful ? 'Success' : 'Failed'}
                                                            </Badge>
                                                        </Table.Td>
                                                        <Table.Td ta="right">{refresh.entries_created}</Table.Td>
                                                        <Table.Td>
                                                            {refresh.error_message ? (
                                                                <Text size="sm" c="red">
                                                                    {refresh.error_message}
                                                                </Text>
                                                            ) : (
                                                                <Text size="sm" c="dimmed">
                                                                    —
                                                                </Text>
                                                            )}
                                                        </Table.Td>
                                                    </Table.Tr>
                                                ))}
                                            </Table.Tbody>
                                        </Table>
                                    </ScrollArea>
                                </Stack>
                            </Stack>
                        )}
                    </Drawer>
                </Stack>
            </AppShell.Main>
        </AppShellLayout>
    );
};

Subscriptions.layout = (page: ReactNode) => (
    <AuthenticatedLayout pageTitle="Subscriptions">{page}</AuthenticatedLayout>
);

export default Subscriptions;
