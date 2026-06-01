import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function RequestAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#005a2f] p-6">
      <section className="w-full max-w-[620px] border-4 border-[#4bb978] bg-[#004a27] px-10 py-12 text-white shadow-2xl">
        <h1 className="text-center text-4xl font-bold">Request Access</h1>
        <p className="mx-auto mt-4 max-w-md text-center text-base text-white/90">
          Account creation is managed by BONASO administrators.
          Please contact your project admin or the BONASO support team to request login access.
        </p>

        <div className="mt-8 flex justify-center">
          <Button asChild className="h-11 rounded-none bg-white px-8 text-lg font-semibold text-[#024025] hover:bg-white/90">
            <Link href="/login">Back to Login</Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
