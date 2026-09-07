// The errors every entry service raises, in one place.
//
// They stay `TRPCError`s even though the REST layer also throws them: the REST
// problem-details mapper reads the tRPC code (`problemFromTRPCError`), so one
// thrown value serves both surfaces and there is no second error taxonomy to
// keep in step with this one.
import { TRPCError } from "@trpc/server";
import mongoose from "mongoose";

export const notFound = (message = "Entry not found"): TRPCError =>
  new TRPCError({ code: "NOT_FOUND", message });

export const badRequest = (message: string): TRPCError =>
  new TRPCError({ code: "BAD_REQUEST", message });

export const invoiceConflict = (message: string): TRPCError =>
  new TRPCError({ code: "CONFLICT", message });

/**
 * Ids arrive as untrusted strings; an id that cannot possibly address a
 * document must read as "missing", not as a 500 from a Mongo cast error.
 */
export const requireObjectId = (id: string, message: string): string => {
  if (!mongoose.isValidObjectId(id)) throw notFound(message);
  return id;
};

export const isDuplicateKeyError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 11000;
};

/**
 * Neutralise a user string before it becomes part of a `RegExp`.
 *
 * The canonical copy, exported for anything that builds a pattern out of
 * caller input — not entries-only, despite the module it sits in, because the
 * catalog's case-insensitive name lookups need exactly the same treatment and
 * a second copy is a copy that misses a metacharacter.
 *
 * Two failure modes, both silent. A search for `a.b` matching `axb` is merely
 * wrong answers; a name lookup for `(a+)+$` handed to Mongo as a pattern is a
 * caller choosing how much CPU the query costs, which is a denial of service
 * written in punctuation.
 */
export const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
