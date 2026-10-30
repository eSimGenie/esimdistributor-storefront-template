/**
 * eSIM-capable devices (commonly sold models). Not exhaustive: carrier-locked phones and some
 * regional variants (e.g. many phones sold in mainland China) do not support eSIM even when
 * the model normally does. Edit freely.
 */
export interface DeviceGroup {
  brand: string;
  models: string[];
  note?: string;
}

export const DEVICES: DeviceGroup[] = [
  {
    brand: 'Apple iPhone',
    models: [
      'iPhone XR, XS, XS Max',
      'iPhone 11, 11 Pro, 11 Pro Max',
      'iPhone SE (2nd and 3rd generation)',
      'iPhone 12, 12 mini, 12 Pro, 12 Pro Max',
      'iPhone 13, 13 mini, 13 Pro, 13 Pro Max',
      'iPhone 14, 14 Plus, 14 Pro, 14 Pro Max',
      'iPhone 15, 15 Plus, 15 Pro, 15 Pro Max',
      'iPhone 16, 16e, 16 Plus, 16 Pro, 16 Pro Max',
      'iPhone 17 series and iPhone Air',
    ],
    note: 'iPhones bought in mainland China, Hong Kong or Macao (except some recent models) have no eSIM.',
  },
  { brand: 'Apple iPad', models: ['iPad Pro 11" and 12.9" (3rd gen and later)', 'iPad Air (3rd gen and later)', 'iPad (7th gen and later)', 'iPad mini (5th gen and later)'], note: 'Wi-Fi + Cellular models only.' },
  {
    brand: 'Samsung Galaxy',
    models: [
      'Galaxy S20, S21, S22, S23, S24, S25 series (incl. FE)',
      'Galaxy Note 20, Note 20 Ultra',
      'Galaxy Z Fold 2 and later, Z Flip and later',
      'Galaxy A35, A54, A55, A56 (selected regions)',
    ],
    note: 'US and Korean variants of some models may not support eSIM.',
  },
  {
    brand: 'Google Pixel',
    models: ['Pixel 3, 3 XL, 3a (not Japan/Australia/Taiwan variants)', 'Pixel 4, 4a, 5, 5a', 'Pixel 6, 6a, 6 Pro', 'Pixel 7, 7a, 7 Pro', 'Pixel 8, 8a, 8 Pro', 'Pixel 9 series and Pixel 10 series', 'Pixel Fold'],
  },
  { brand: 'Motorola', models: ['razr (2019) and later razr models', 'edge 40, edge 50 series', 'moto g54, g84, g85'] },
  { brand: 'Xiaomi', models: ['Xiaomi 12T Pro, 13, 13 Pro, 13T, 14, 14 Pro, 14T, 15'], note: 'Global versions only.' },
  { brand: 'OPPO / OnePlus', models: ['OPPO Find X3 Pro, X5, X5 Pro, X8', 'OnePlus 11, 12, 13'] },
  { brand: 'Huawei', models: ['P40, P40 Pro', 'Mate 40 Pro'] },
  { brand: 'Sony', models: ['Xperia 1 IV and later', 'Xperia 5 IV and later', 'Xperia 10 III Lite, 10 IV and later'] },
];
