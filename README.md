This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## PL Forecast Dashboard 규칙

### 단위 표기
- **모든 금액은 K 단위 사용** (예: `94,912K`)
- 억원, 만원 등 다른 단위 사용하지 않음
- 단위 표기: `CNY K (천 위안)`

### 계산 방식
- **직접비 월말예상**: 목표직접비 ÷ 목표실판(V-) × 월말예상실판(V-) (매출 연동)
- **영업비 월말예상**: 목표 영업비 그대로 사용 (고정비 성격)
- **달성율**: 월말예상 ÷ 목표 × 100%
- **직접이익**: 매출총이익 - 직접비
- **영업이익**: 매출총이익 - 직접비 - 영업비

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
