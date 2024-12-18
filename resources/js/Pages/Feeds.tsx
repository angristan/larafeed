import { UserButton } from '../Components/UserButton/UserButton';
import classes from './NavbarSearch.module.css';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Split } from '@gfazioli/mantine-split-pane';
import { Head, usePage } from '@inertiajs/react';
import {
    ActionIcon,
    Badge,
    Code,
    Group,
    Image,
    ScrollArea,
    Text,
    TextInput,
    Tooltip,
    UnstyledButton,
} from '@mantine/core';
import {
    IconBulb,
    IconCheckbox,
    IconPlus,
    IconSearch,
    IconUser,
} from '@tabler/icons-react';

const links = [
    { icon: IconBulb, label: 'Activity', notifications: 3 },
    { icon: IconCheckbox, label: 'Tasks', notifications: 4 },
    { icon: IconUser, label: 'Contacts' },
];

interface Feed {
    id: number;
    name: string;
    favicon_url: string;
    site_url: string;
    entries_count: number;
    last_crawled_at: string;
    sparkline: string;
}

export default function NavbarSearch({ feeds }: { feeds: Feed[] }) {
    const user = usePage().props.auth.user;

    const mainLinks = links.map((link) => (
        <UnstyledButton key={link.label} className={classes.mainLink}>
            <div className={classes.mainLinkInner}>
                <link.icon
                    size={20}
                    className={classes.mainLinkIcon}
                    stroke={1.5}
                />
                <span>{link.label}</span>
            </div>
            {link.notifications && (
                <Badge
                    size="sm"
                    variant="filled"
                    className={classes.mainLinkBadge}
                >
                    {link.notifications}
                </Badge>
            )}
        </UnstyledButton>
    ));

    const feedLinks = feeds.map((feed) => (
        <a
            href="#"
            onClick={(event) => event.preventDefault()}
            key={feed.name}
            className={classes.collectionLink}
        >
            <div style={{ display: 'flex', alignItems: 'center' }}>
                <Image src={feed.favicon_url} w={20} h={20} mr={9} />
                <span>{feed.name}</span>
            </div>
        </a>
    ));

    return (
        <AuthenticatedLayout>
            <Head title="Dashboard" />
            <div
                style={{
                    display: 'flex',
                    height: '100vh',
                    width: '100vw',
                    overflow: 'hidden',
                }}
            >
                <nav className={classes.navbar}>
                    <div className={classes.section}>
                        <UserButton user={user} />
                    </div>

                    <TextInput
                        placeholder="Search"
                        size="xs"
                        leftSection={<IconSearch size={12} stroke={1.5} />}
                        rightSectionWidth={70}
                        rightSection={
                            <Code className={classes.searchCode}>Ctrl + K</Code>
                        }
                        styles={{ section: { pointerEvents: 'none' } }}
                        mb="sm"
                    />

                    <div className={classes.section}>
                        <div className={classes.mainLinks}>{mainLinks}</div>
                    </div>

                    <div className={classes.section}>
                        <Group
                            className={classes.collectionsHeader}
                            justify="space-between"
                        >
                            <Text size="xs" fw={500} c="dimmed">
                                Feeds
                            </Text>
                            <Tooltip
                                label="Create feed"
                                withArrow
                                position="right"
                            >
                                <ActionIcon variant="default" size={18}>
                                    <IconPlus size={12} stroke={1.5} />
                                </ActionIcon>
                            </Tooltip>
                        </Group>
                        <div className={classes.collections}>{feedLinks}</div>
                    </div>
                </nav>
                <main
                    style={{
                        height: '100%',
                        width: '100%',
                        backgroundColor: 'lightskyblue',
                    }}
                >
                    <Split
                        style={{
                            height: '100%',
                        }}
                    >
                        <Split.Pane
                            initialWidth="50%"
                            style={{
                                height: '100%',
                            }}
                        >
                            <ScrollArea
                                style={{
                                    backgroundColor: 'lightcoral',
                                    height: '100%',
                                }}
                            >
                                {lorem}
                            </ScrollArea>
                        </Split.Pane>
                        <Split.Pane
                            grow
                            style={{
                                backgroundColor: 'lightgreen',
                                height: '100%',
                            }}
                        >
                            {lorem}
                        </Split.Pane>
                    </Split>
                </main>
            </div>
        </AuthenticatedLayout>
    );
}

const lorem = `
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam a nunc vel nunc tincidunt convallis. Sed aliquet nec tortor mollis bibendum. Aliquam erat volutpat. Nullam aliquet lorem id porttitor laoreet. Maecenas imperdiet nibh sit amet magna malesuada fermentum. Suspendisse vel enim enim. In tempus est dapibus luctus placerat. Duis laoreet ut neque ac tincidunt. Nam et elit at velit molestie aliquet at et ante. Vivamus varius tellus non lorem aliquet, ut elementum risus mollis. Vivamus arcu ipsum, ullamcorper non purus dictum, mollis tempor eros. Integer dignissim ac lectus pretium lacinia. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Etiam mattis arcu sapien. Aliquam et laoreet nisi. Etiam tincidunt consequat erat, nec tristique ligula. Vestibulum mi tellus, imperdiet a mollis eget, vulputate vel leo. Morbi urna dolor, varius non tempus at, auctor in mauris. In euismod nisi vulputate liberoelementum condimentum. Quisque necsapien lorem. Etiam facilisis commodonunc, nec rutrum magna volutpat quis.Quisque et placerat felis. Vivamus duiodio, tincidunt quis faucibus id,blandit et nisi. Quisque urna ipsum,pretium nec tellus nec, egestas cursussapien. Nam auctor nulla elit, rutrumultrices ex pharetra at. Fusce vehiculanulla imperdiet risus porttitor, nonlacinia velit ultricies. Ut dui augue,dapibus sit amet felis id, rhoncusfringilla ex. Praesent dictum eleifendsem, vel lobortis nibh tempus eu.Curabitur commodo, sapien nec fermentumefficitur, nulla augue finibus dui, eupulvinar odio nisl a nisi. Maecenaseuismod lacinia orci ac laoreet. Maurislobortis nibh diam, sed porttitor quammolestie at. Cras ultrices mi justo, atfinibus ex suscipit vel. Mauris etligula vestibulum, cursus quam vel,vulputate ex. Phasellus eget risus atfelis pulvinar fermentum non a libero.Interdum et malesuada fames ac anteipsum primis in faucibus. Aliquam acsemper turpis. Phasellus pretium purussit amet dolor placerat, sedpellentesque odio malesuada. Phasellustristique purus a commodo laoreet.Suspendisse venenatis, quam at elementuminterdum, purus lectus eleifend magna,consequat tincidunt sem dolor mattiserat. Vivamus gravida volutpat augue,vestibulum facilisis est viverra in.Etiam in nibh facilisis, tristique estet, sollicitudin diam. Suspendissecongue tempor mauris non posuere. Donecmollis sagittis molestie. Aliquam massajusto, accumsan id consequat ac, portanon lectus. Nulla facilisi. Vivamusconsectetur, ex posuere pulvinarmaximus, dui sem euismod lorem, egetsagittis enim ligula eget leo. Maecenasin ullamcorper mi. Vivamus fermentumviverra mauris, eu egestas augue portavel. Praesent at efficitur est, vitaelobortis nibh. Lorem ipsum dolor sitamet, consectetur adipiscing elit. Sedornare orci at mi ultrices, eu rutrumipsum tempus. Vivamus a volutpat augue.Quisque eget massa sapien. Etiam insodales lectus, fermentum ullamcorpermauris. Nam tincidunt lorem eget tellusfaucibus rhoncus. Cras tincidunt dolorante, eget maximus elit molestie ac.Quisque ultricies quis odio vel semper.Nulla convallis purus ac dolor laoreetfringilla. Vivamus posuere dui at arcualiquam tempus. Quisque egestas turpisin enim aliquet faucibus. Suspendisse aceleifend turpis. us gravida volutpat augue,vestibulum facilisis est viverra in.Etiam in nibh facilisis, tristique estet, sollicitudin diam. Suspendissecongue tempor mauris non posuere. Donecmollis sagittis molestie. Aliquam massajusto, accumsan id consequat ac, portanon lectus. Nulla facilisi. Vivamusconsectetur, ex posuere pulvinarmaximus, dui sem euismod lorem, egetsagittis enim ligula eget leo. Maecenasin ullamcorper mi. Vivamus fermentumviverra mauris, eu egestas augue portavel. Praesent at efficitur est, vitaelobortis nibh. Lorem ipsum dolor sitamet, consectetur adipiscing elit. Sedornare orci at mi ultrices, eu rutrumipsum tempus. Vivamus a volutpat augue.Quisque eget massa sapien. Etiam insodales lectus, fermentum ullamcorpermauris. Nam tincidunt lorem eget tellusfaucibus rhoncus. Cras tincidunt dolorante, eget maximus elit molestie ac.Quisque ultricies quis odio vel semper.Nulla convallis purus ac dolor laoreetfringilla. Vivamus posuere dui at arcualiquam tempus. Quisque egestas turpisin enim aliquet faucibus. Suspendisse aceleifend turpis.`;
