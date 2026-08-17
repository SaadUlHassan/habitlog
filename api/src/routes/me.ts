import { Router } from "express";
import { localDateFor } from "../domain/dates.js";
import { requireUser } from "../middleware/auth.js";

export const meRouter = Router();

meRouter.get("/me", (req, res) => {
  const user = requireUser(req);

  res.json({
    id: user.id,
    displayName: user.displayName,
    timezone: user.timezone,
    // The client is told what day it is rather than working it out. Every date in the
    // system is decided server-side from the user's timezone; the frontend does no
    // date arithmetic at all.
    today: localDateFor(new Date(), user.timezone),
  });
});
