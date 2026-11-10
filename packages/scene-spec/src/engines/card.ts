// CardData: the `card` engine has no 3D scene, only the common player.
import { z } from "zod";

export const CardData = z.object({}).strict();
export type CardData = z.infer<typeof CardData>;
