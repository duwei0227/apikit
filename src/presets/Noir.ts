import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

const Noir = definePreset(Aura, {
    semantic: {
        primary: {
            50: '{surface.50}',
            100: '{surface.100}',
            200: '{surface.200}',
            300: '{surface.300}',
            400: '{surface.400}',
            500: '{surface.500}',
            600: '{surface.600}',
            700: '{surface.700}',
            800: '{surface.800}',
            900: '{surface.900}',
            950: '{surface.950}'
        },
        colorScheme: {
            light: {
                primary: {
                color: '{primary.950}',
                contrastColor: '#ffffff',
                hoverColor: '{primary.900}',
                activeColor: '{primary.800}'
                },
                highlight: {
                background: '{primary.950}',
                focusBackground: '{primary.700}',
                color: '#ffffff',
                focusColor: '#ffffff'
                },
            },
            // 暗色：VS Code「2026 Dark」配色（microsoft/vscode theme-defaults/themes/2026-dark.json）
            dark: {
                surface: {
                    0: '#ffffff',
                    50: '#ededed',
                    100: '#dcdcdc',
                    200: '#cccccc',
                    300: '#bfbfbf', // foreground
                    400: '#8c8c8c', // descriptionForeground
                    500: '#6b6c6d',
                    600: '#333536', // input.border
                    700: '#2a2b2c', // panel / sideBar / tab border
                    800: '#202122', // menu / editorWidget
                    900: '#191a1b', // sideBar / panel / titleBar
                    950: '#121314'  // editor / active tab
                },
                primary: {
                    color: '#297aa0', // button.background
                    contrastColor: '#ffffff',
                    hoverColor: '#3088b0',
                    activeColor: '#256d8f'
                },
                highlight: {
                    background: 'rgba(255, 255, 255, 0.13)', // list.activeSelectionBackground
                    focusBackground: 'rgba(255, 255, 255, 0.18)',
                    color: '#ededed',
                    focusColor: '#ffffff'
                },
                focusRing: {
                    color: '#3994bc' // focusBorder
                },
                text: {
                    color: '{surface.200}',
                    hoverColor: '{surface.50}',
                    mutedColor: '{surface.400}',
                    hoverMutedColor: '{surface.300}'
                },
                formField: {
                    background: '{surface.900}', // input.background
                    borderColor: '{surface.600}',
                    hoverBorderColor: '{surface.500}',
                    focusBorderColor: '#3994bc',
                    color: '{surface.200}'
                },
                overlay: {
                    select: { background: '{surface.800}', borderColor: '{surface.700}' },
                    popover: { background: '{surface.800}', borderColor: '{surface.700}' }
                },
                list: {
                    option: { focusBackground: 'rgba(255, 255, 255, 0.08)' } // list.hoverBackground
                },
                navigation: {
                    item: {
                        focusBackground: 'rgba(255, 255, 255, 0.08)',
                        activeBackground: 'rgba(255, 255, 255, 0.13)'
                    }
                }
            }
        }
    }
});

export default Noir;
        