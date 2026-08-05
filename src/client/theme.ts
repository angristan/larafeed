import {
    ActionIcon,
    Alert,
    Badge,
    Button,
    type CSSVariablesResolver,
    createTheme,
    Drawer,
    FileInput,
    Menu,
    Modal,
    NativeSelect,
    NavLink,
    Paper,
    SegmentedControl,
    Select,
    Textarea,
    TextInput,
} from '@mantine/core';

import classes from './theme.module.css';

const sans =
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const mono =
    '"SFMono-Regular", Consolas, "Liberation Mono", ui-monospace, monospace';

const colors = {
    light: {
        canvas: '#ebe7df',
        paper: '#fffdf8',
        paperMuted: '#f4efe7',
        paperStrong: '#e2dacf',
        ink: '#29241f',
        muted: '#655d55',
        subtle: '#766d64',
        line: '#d3c8ba',
        lineStrong: '#897b6e',
        accent: '#c87352',
        accentBorder: '#824630',
        sage: '#0c746f',
        sageSurface: '#d9ece7',
        sky: '#476f7c',
        skySurface: '#dce9eb',
        rust: '#aa4437',
        rustStrong: '#803229',
        rustSurface: '#f4ddd6',
        panel: '#302722',
        panelText: '#f7eee2',
        focus: '#0c746f',
        shadow: 'rgba(59, 45, 35, 0.2)',
    },
    dark: {
        canvas: '#151210',
        paper: '#211d1a',
        paperMuted: '#191614',
        paperStrong: '#342c26',
        ink: '#f5ecdf',
        muted: '#cbbdaf',
        subtle: '#aa9a8b',
        line: '#493f37',
        lineStrong: '#78685b',
        accent: '#e18a68',
        accentBorder: '#aa5d40',
        sage: '#6bc4b9',
        sageSurface: '#1b3733',
        sky: '#91b8c3',
        skySurface: '#1b3035',
        rust: '#f08a76',
        rustStrong: '#ffae99',
        rustSurface: '#42251f',
        panel: '#0b0908',
        panelText: '#f5ecdf',
        focus: '#6bc4b9',
        shadow: 'rgba(0, 0, 0, 0.48)',
    },
} as const;

type SemanticPalette = {
    [Key in keyof (typeof colors)['light']]: string;
};

const semanticVariables = (
    palette: SemanticPalette,
    scheme: 'light' | 'dark',
) => {
    const dark = scheme === 'dark';
    return {
        '--ds-canvas': palette.canvas,
        '--ds-paper': palette.paper,
        '--ds-paper-muted': palette.paperMuted,
        '--ds-paper-strong': palette.paperStrong,
        '--ds-ink': palette.ink,
        '--ds-muted': palette.muted,
        '--ds-subtle': palette.subtle,
        '--ds-line': palette.line,
        '--ds-line-strong': palette.lineStrong,
        '--ds-accent': palette.accent,
        '--ds-accent-border': palette.accentBorder,
        '--ds-accent-surface': `color-mix(in srgb, ${palette.accent} 14%, ${palette.paper})`,
        '--ds-sage': palette.sage,
        '--ds-sage-surface': palette.sageSurface,
        '--ds-sky': palette.sky,
        '--ds-sky-surface': palette.skySurface,
        '--ds-rust': palette.rust,
        '--ds-rust-strong': palette.rustStrong,
        '--ds-rust-surface': palette.rustSurface,
        '--ds-panel': palette.panel,
        '--ds-panel-text': palette.panelText,
        '--ds-focus': palette.focus,
        '--ds-shadow-color': palette.shadow,
        '--ds-glass': `color-mix(in srgb, ${palette.paper} ${dark ? 54 : 44}%, transparent)`,
        '--ds-glass-strong': `color-mix(in srgb, ${palette.paper} ${dark ? 70 : 64}%, transparent)`,
        '--ds-glass-overlay': `color-mix(in srgb, ${palette.paper} ${dark ? 88 : 86}%, transparent)`,
        '--ds-glass-line': dark
            ? `color-mix(in srgb, ${palette.ink} 20%, transparent)`
            : `color-mix(in srgb, ${palette.lineStrong} 56%, transparent)`,
        '--ds-glass-highlight': dark
            ? `color-mix(in srgb, ${palette.ink} 18%, transparent)`
            : `color-mix(in srgb, ${palette.paper} 94%, transparent)`,
        '--ds-glass-refraction': `color-mix(in srgb, ${palette.sage} ${dark ? 19 : 16}%, transparent)`,
    };
};

export const cssVariablesResolver: CSSVariablesResolver = () => ({
    variables: {
        '--ds-font-sans': sans,
        '--ds-font-mono': mono,
        '--ds-space-1': '4px',
        '--ds-space-2': '8px',
        '--ds-space-3': '12px',
        '--ds-space-4': '18px',
        '--ds-space-5': '24px',
        '--ds-space-6': '34px',
        '--ds-space-7': '48px',
        '--ds-radius-xs': '3px',
        '--ds-radius-sm': '6px',
        '--ds-radius-md': '10px',
        '--ds-radius-lg': '14px',
        '--ds-radius-xl': '18px',
        '--ds-motion-fast': '120ms',
        '--ds-motion-standard': '180ms',
        '--ds-motion-slow': '240ms',
        '--ds-motion-easing': 'cubic-bezier(0.2, 0, 0, 1)',
        '--ds-prose-width': '760px',
        '--ds-content-width': '1000px',
        '--ds-shell-width': '1460px',
        '--ds-on-accent': '#21140f',
        '--ds-glass-blur': '26px',
        '--ds-glass-saturate': '1.28',
        '--ds-glass-brightness': '1.04',
        '--ds-glass-contrast': '1.02',
        '--ds-glass-sheen':
            'linear-gradient(135deg, color-mix(in srgb, var(--ds-glass-highlight) 66%, transparent) 0%, transparent 36%, transparent 72%, color-mix(in srgb, var(--ds-glass-refraction) 40%, transparent) 100%)',
        '--ds-surface-inset': 'var(--ds-paper-muted)',
        '--ds-surface-work': 'var(--ds-paper)',
        '--ds-surface-work-header':
            'color-mix(in srgb, var(--ds-paper-muted) 88%, var(--ds-paper))',
        '--ds-work-line':
            'color-mix(in srgb, var(--ds-line-strong) 72%, var(--ds-line))',
        '--ds-shadow-inset':
            'inset 0 1px 2px color-mix(in srgb, var(--ds-ink) 9%, transparent), inset 0 -1px 0 color-mix(in srgb, var(--ds-glass-highlight) 72%, transparent)',
        '--ds-shadow-work':
            '0 1px 0 color-mix(in srgb, var(--ds-line-strong) 44%, transparent), 0 10px 22px -20px color-mix(in srgb, var(--ds-ink) 38%, transparent), inset 0 1px 0 color-mix(in srgb, var(--ds-glass-highlight) 78%, transparent)',
        '--ds-shadow-control':
            '0 8px 18px -14px color-mix(in srgb, var(--ds-ink) 50%, transparent)',
        '--ds-shadow-control-hover':
            '0 12px 24px -16px color-mix(in srgb, var(--ds-ink) 58%, transparent)',
        '--ds-shadow-xs': '2px 2px 0 var(--ds-shadow-color)',
        '--ds-shadow-sm':
            '0 8px 18px -14px color-mix(in srgb, var(--ds-ink) 42%, transparent)',
        '--ds-shadow-md':
            '0 18px 40px -28px color-mix(in srgb, var(--ds-ink) 46%, transparent)',
        '--ds-shadow-lg':
            '0 24px 58px -30px color-mix(in srgb, var(--ds-ink) 52%, transparent)',
        '--ds-shadow-xl':
            '0 30px 72px -34px color-mix(in srgb, var(--ds-ink) 58%, transparent)',
        '--ds-shadow-float':
            '0 30px 68px -34px color-mix(in srgb, var(--ds-ink) 62%, transparent), 0 12px 26px -20px color-mix(in srgb, var(--ds-sage) 26%, transparent), inset 0 1px 0 var(--ds-glass-highlight), inset 0 -1px 0 var(--ds-glass-refraction)',
    },
    light: semanticVariables(colors.light, 'light'),
    dark: semanticVariables(colors.dark, 'dark'),
});

const sage = [
    '#ecf8f5',
    '#d9ece7',
    '#b5ddd5',
    '#87c8bd',
    '#58aea4',
    '#319188',
    '#187b75',
    '#126d69',
    '#105754',
    '#0e4543',
] as const;
const sky = [
    '#f0f7f8',
    '#dce9eb',
    '#bfd8de',
    '#99c0ca',
    '#73a7b4',
    '#588d9c',
    '#416c7b',
    '#345866',
    '#2b4853',
    '#243a43',
] as const;
const honey = [
    '#fbf1ec',
    '#f5dfd5',
    '#ebc3b1',
    '#dfa288',
    '#d08362',
    '#bd6b49',
    '#a7593b',
    '#8d4c35',
    '#75432f',
    '#5f3729',
] as const;
const rust = [
    '#fff3ed',
    '#fbe2d6',
    '#f3c1aa',
    '#e99b79',
    '#de7952',
    '#c85f3d',
    '#a94b31',
    '#873d2b',
    '#6d3327',
    '#572b23',
] as const;
const warmGray = [
    '#faf8f4',
    '#f1ede7',
    '#e2dbd2',
    '#cfc4b8',
    '#b5a79a',
    '#96877a',
    '#766d64',
    '#5c534c',
    '#3e3732',
    '#27221e',
] as const;

const inputClassNames = {
    label: classes.inputLabel,
    description: classes.inputDescription,
    input: classes.input,
    error: classes.inputError,
};

const overlayClassNames = {
    content: classes.overlayContent,
    header: classes.overlayHeader,
    body: classes.overlayBody,
    title: classes.overlayTitle,
};

export const theme = createTheme({
    primaryColor: 'sage',
    primaryShade: { light: 7, dark: 4 },
    autoContrast: true,
    luminanceThreshold: 0.45,
    black: colors.light.ink,
    white: colors.light.paper,
    colors: {
        sage,
        sky,
        honey,
        rust,
        blue: sky,
        green: sage,
        orange: honey,
        red: rust,
        gray: warmGray,
        dark: [
            '#f4e4ce',
            '#dfcdb9',
            '#cdb9a5',
            '#ad9988',
            '#755c4d',
            '#49392f',
            '#33251f',
            '#211a17',
            '#1b1614',
            '#13100f',
        ],
    },
    fontFamily: sans,
    fontFamilyMonospace: mono,
    headings: {
        fontFamily: sans,
        fontWeight: '650',
        textWrap: 'balance',
        sizes: {
            h1: {
                fontSize: 'clamp(1.75rem, 3vw, 2.35rem)',
                lineHeight: '1.12',
            },
            h2: { fontSize: '1.25rem', lineHeight: '1.25' },
            h3: { fontSize: '1.05rem', lineHeight: '1.3' },
        },
    },
    defaultRadius: 'md',
    radius: { xs: '3px', sm: '6px', md: '10px', lg: '14px', xl: '18px' },
    spacing: { xs: '8px', sm: '12px', md: '18px', lg: '24px', xl: '34px' },
    breakpoints: {
        xs: '30em',
        sm: '43.75em',
        md: '56.25em',
        lg: '75em',
        xl: '90em',
    },
    shadows: {
        xs: 'var(--ds-shadow-xs)',
        sm: 'var(--ds-shadow-sm)',
        md: 'var(--ds-shadow-md)',
        lg: 'var(--ds-shadow-lg)',
        xl: 'var(--ds-shadow-xl)',
    },
    respectReducedMotion: true,
    cursorType: 'pointer',
    components: {
        Button: Button.extend({
            defaultProps: { radius: 'md' },
            classNames: {
                root: classes.buttonRoot,
                label: classes.buttonLabel,
                section: classes.buttonSection,
            },
        }),
        ActionIcon: ActionIcon.extend({
            defaultProps: { radius: 'md' },
            classNames: { root: classes.actionIconRoot },
        }),
        SegmentedControl: SegmentedControl.extend({
            defaultProps: { radius: 'md', withItemsBorders: false },
            classNames: {
                root: classes.segmentedRoot,
                label: classes.segmentedLabel,
                indicator: classes.segmentedIndicator,
            },
        }),
        Paper: Paper.extend({
            defaultProps: { radius: 'lg' },
            classNames: { root: classes.paperRoot },
        }),
        Alert: Alert.extend({
            defaultProps: { radius: 'md', variant: 'light' },
            classNames: {
                root: classes.alertRoot,
                title: classes.alertTitle,
                message: classes.alertMessage,
            },
        }),
        Badge: Badge.extend({
            defaultProps: { radius: 'sm', variant: 'light' },
            classNames: { root: classes.badgeRoot, label: classes.badgeLabel },
        }),
        TextInput: TextInput.extend({ classNames: inputClassNames }),
        Textarea: Textarea.extend({ classNames: inputClassNames }),
        NativeSelect: NativeSelect.extend({ classNames: inputClassNames }),
        FileInput: FileInput.extend({ classNames: inputClassNames }),
        Select: Select.extend({
            classNames: {
                ...inputClassNames,
                dropdown: classes.dropdown,
                option: classes.option,
            },
        }),
        NavLink: NavLink.extend({
            classNames: {
                root: classes.navLinkRoot,
                label: classes.navLinkLabel,
                description: classes.navLinkDescription,
                section: classes.navLinkSection,
            },
        }),
        Menu: Menu.extend({
            classNames: {
                dropdown: classes.dropdown,
                item: classes.menuItem,
                divider: classes.divider,
            },
        }),
        Modal: Modal.extend({ classNames: overlayClassNames }),
        Drawer: Drawer.extend({ classNames: overlayClassNames }),
    },
});
