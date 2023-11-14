import * as Schema from "@effect/schema/Schema";
import { secretbox } from "@noble/ciphers/salsa";
import { concatBytes } from "@noble/ciphers/utils";
import { hmac } from "@noble/hashes/hmac";
import { sha512 } from "@noble/hashes/sha512";
import { randomBytes } from "@noble/hashes/utils";
import { Brand, Context, Effect, Layer } from "effect";
import { customAlphabet, nanoid } from "nanoid";

export interface Bip39 {
  readonly make: Effect.Effect<never, never, Mnemonic>;

  readonly toSeed: (
    mnemonic: Mnemonic,
  ) => Effect.Effect<never, never, Uint8Array>;

  readonly parse: (
    mnemonic: string,
  ) => Effect.Effect<never, InvalidMnemonicError, Mnemonic>;
}

export const Bip39 = Context.Tag<Bip39>();

export interface InvalidMnemonicError {
  readonly _tag: "InvalidMnemonicError";
}

/**
 * Mnemonic is a password generated by Evolu in BIP39 format.
 *
 * A mnemonic, also known as a "seed phrase," is a set of 12 words in a
 * specific order chosen from a predefined list. The purpose of the BIP39
 * mnemonic is to provide a human-readable way of storing a private key.
 */
export type Mnemonic = string & Brand.Brand<"Mnemonic">;

export interface NanoId {
  readonly nanoid: Effect.Effect<never, never, string>;
  readonly nanoidAsNodeId: Effect.Effect<never, never, NodeId>;
}

export const NanoId = Context.Tag<NanoId>();

export const NodeId: Schema.BrandSchema<
  string,
  string & Brand.Brand<"NodeId">
> = Schema.string.pipe(Schema.pattern(/^[\w-]{16}$/), Schema.brand("NodeId"));
export type NodeId = Schema.Schema.To<typeof NodeId>;

const nanoidForNodeId = customAlphabet("0123456789abcdef", 16);

export const NanoIdLive = Layer.succeed(
  NanoId,
  NanoId.of({
    nanoid: Effect.sync(() => nanoid()),
    nanoidAsNodeId: Effect.sync(() => nanoidForNodeId() as NodeId),
  }),
);

/**
 * SLIP-21 implementation
 * https://github.com/satoshilabs/slips/blob/master/slip-0021.md
 */
export const slip21Derive = (
  seed: Uint8Array,
  path: ReadonlyArray<string>,
): Effect.Effect<never, never, Uint8Array> =>
  Effect.sync(() => {
    let m = hmac(sha512, "Symmetric key seed", seed);
    for (let i = 0; i < path.length; i++) {
      const p = new TextEncoder().encode(path[i]);
      const e = new Uint8Array(p.byteLength + 1);
      e[0] = 0;
      e.set(p, 1);
      m = hmac(sha512, m.slice(0, 32), e);
    }
    return m.slice(32, 64);
  });

/**
 * Alias to xsalsa20poly1305, for compatibility with libsodium / nacl
 */
export interface SecretBox {
  readonly seal: (
    key: Uint8Array,
    plaintext: Uint8Array,
  ) => Effect.Effect<never, never, Uint8Array>;

  readonly open: (
    key: Uint8Array,
    ciphertext: Uint8Array,
  ) => Effect.Effect<never, never, Uint8Array>;
}

export const SecretBox = Context.Tag<SecretBox>();

export const SecretBoxLive = Layer.succeed(
  SecretBox,
  SecretBox.of({
    seal: (key, plaintext) =>
      Effect.sync(() => {
        const nonce = randomBytes(24);
        const ciphertext = secretbox(key, nonce).seal(plaintext);
        return concatBytes(nonce, ciphertext);
      }),
    open: (key, ciphertext) =>
      Effect.sync(() => {
        const nonce = ciphertext.subarray(0, 24);
        const ciphertextWithoutNonce = ciphertext.subarray(24);
        return secretbox(key, nonce).open(ciphertextWithoutNonce);
      }),
  }),
);
