import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://irooqmewtvsfoqscwncs.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_f_nThHb-5Er4HwOX_XWf4w_8SJV6fSq";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export function authRedirectUrl() {
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  return url.toString();
}

export function supabaseVaultStore(client = supabase) {
  return {
    async pull() {
      const { data, error } = await client.from("still_vaults").select("revision,iv,ciphertext,wrapped_iv,wrapped_ct").maybeSingle();
      if (error) {
        const failure = new Error("The account list could not be read.");
        failure.status = 0;
        throw failure;
      }
      if (!data) return { revision: 0, blob: null, wrappedSyncKey: null };
      return {
        revision: Number(data.revision) || 0,
        blob: { iv: data.iv, ct: data.ciphertext },
        wrappedSyncKey: { iv: data.wrapped_iv, ct: data.wrapped_ct },
      };
    },
    async push({ baseRevision, blob, wrappedSyncKey }) {
      if (!blob?.iv || !blob?.ct) {
        const failure = new Error("Refusing to upload an empty list.");
        failure.status = 400;
        throw failure;
      }
      const { data: userData, error: userError } = await client.auth.getUser();
      const userId = userData?.user?.id;
      if (userError || !userId || !userData.user.email_confirmed_at) {
        const failure = new Error("Confirm the email before syncing.");
        failure.status = 401;
        throw failure;
      }
      const existing = await this.pull();
      if (!existing.blob) {
        if (!wrappedSyncKey?.iv || !wrappedSyncKey?.ct) {
          const failure = new Error("The encryption key was not ready.");
          failure.status = 400;
          throw failure;
        }
        const { error } = await client.from("still_vaults").insert({
          user_id: userId,
          revision: 0,
          iv: blob.iv,
          ciphertext: blob.ct,
          wrapped_iv: wrappedSyncKey.iv,
          wrapped_ct: wrappedSyncKey.ct,
        });
        if (error) {
          const failure = new Error("The account list changed.");
          failure.status = 409;
          failure.body = await this.pull();
          throw failure;
        }
        return { revision: 0 };
      }
      const { data, error } = await client
        .from("still_vaults")
        .update({
          revision: baseRevision + 1,
          iv: blob.iv,
          ciphertext: blob.ct,
        })
        .eq("revision", baseRevision)
        .select("revision")
        .maybeSingle();
      if (error || !data) {
        const failure = new Error("The account list changed.");
        failure.status = 409;
        failure.body = await this.pull();
        throw failure;
      }
      return { revision: Number(data.revision) };
    },
  };
}
