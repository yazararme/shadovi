import { redirect } from "next/navigation";

// Preserve ?client= param when forwarding to the first sub-page
export default async function RefinePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client } = await searchParams;
  if (client) {
    redirect(`/refine/brand?client=${client}`);
  }
  redirect("/discover");
}
