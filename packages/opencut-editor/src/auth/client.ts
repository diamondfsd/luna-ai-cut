import { createAuthClient } from "better-auth/react";
import { webEnv } from "@/env/web";

export const { signIn, signUp, useSession } = createAuthClient({
	baseURL: webEnv.NEXT_PUBLIC_SITE_URL,
});
