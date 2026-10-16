import { useColorScheme } from 'react-native';

const light = {
  bg: '#f3f5f8', card: '#ffffff', text: '#12181f', sub: '#5d6b7a', border: '#dde3ea',
  primary: '#1f7ae0', onPrimary: '#ffffff', danger: '#d64545', ok: '#2e9e5b', warn: '#d9902f',
  chip: '#e8edf3', chipActive: '#1f7ae0', chipText: '#12181f', mapBg: '#181c21',
};
const dark: typeof light = {
  bg: '#0e1217', card: '#171d24', text: '#eef2f6', sub: '#93a1b0', border: '#26303a',
  primary: '#4b9bf5', onPrimary: '#06121f', danger: '#ef6b6b', ok: '#48c079', warn: '#e8a851',
  chip: '#222b35', chipActive: '#4b9bf5', chipText: '#eef2f6', mapBg: '#0a0d10',
};

export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);
