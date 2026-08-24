import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ReasonMessage } from "./reason-message";

export const metadata: Metadata = {
  title: "Subscription link problem",
  robots: { index: false, follow: false },
};

export default function ErrorPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-3xl md:text-4xl font-semibold">Hmm.</h1>
      <Suspense fallback={<p className="mt-4 text-gray-600">&nbsp;</p>}>
        <ReasonMessage />
      </Suspense>
      <p className="mt-8 flex justify-center gap-6 text-sm">
        <Link href="/sub" className="underline underline-offset-2 hover:opacity-70">
          Try again
        </Link>
        <Link href="/" className="underline underline-offset-2 hover:opacity-70">
          Back to the site
        </Link>
      </p>
    </div>
  );
}
