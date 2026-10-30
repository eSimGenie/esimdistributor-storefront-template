import type { SiteConfig } from './config-schema';

export function homeFaq(site: SiteConfig) {
  return [
    {
      q: 'What is an eSIM?',
      a: 'An eSIM is a digital SIM built into your phone. Instead of inserting a plastic card you scan a QR code, and your phone downloads the mobile plan in a minute.',
    },
    {
      q: 'Will my phone work?',
      a: 'Most phones released since 2019 support eSIM, including iPhone XR and later, Google Pixel 3 and later and Samsung Galaxy S20 and later. Your phone must also be carrier-unlocked. See the compatibility page for the full list and how to check.',
    },
    {
      q: 'When does my plan start?',
      a: 'Your plan starts when the eSIM first connects to a supported network at your destination, not when you buy or install it. We recommend installing it at home on Wi-Fi a day or two before you fly.',
    },
    {
      q: 'Can I keep my WhatsApp and my normal number?',
      a: 'Yes. The travel eSIM is data only and sits next to your normal SIM. WhatsApp, iMessage and similar apps keep using your usual number.',
    },
    {
      q: 'How do I receive my eSIM?',
      a: 'Straight after payment: the QR code and install steps appear on screen and are emailed to you. You can always find your order again from the "Find my order" page.',
    },
    {
      q: 'Can I get a refund?',
      a: `If your eSIM has not been installed, contact ${site.supportEmail} and we will help. Once an eSIM has been installed or used it cannot be refunded — please check device compatibility before you buy.`,
    },
  ];
}

export const steps = [
  { title: 'Pick your destination', body: 'Choose a country or region and the data plan that fits your trip.' },
  { title: 'Pay securely', body: 'Checkout takes under a minute with card, Apple Pay or Google Pay.' },
  { title: 'Scan & go', body: 'Scan the QR code we show and email you. You are online the moment you land.' },
];

export const benefits = [
  { title: 'No roaming surprises', body: 'Fixed price, prepaid. No contracts and no bills when you get home.' },
  { title: 'Instant delivery', body: 'Your eSIM arrives seconds after payment — no shipping, no shop visit.' },
  { title: 'Keep your number', body: 'Data-only eSIM next to your own SIM: WhatsApp and iMessage keep working.' },
  { title: 'Local networks', body: 'Connect to leading local operators with 4G/5G where available.' },
];
