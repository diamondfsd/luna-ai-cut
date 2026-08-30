#!/usr/bin/env node
import assert from 'node:assert/strict'

import {
  buildDirectMessagePacket,
  buildEncryptedMessagePacket,
  buildGetOptionsRequest,
  encodeStringField,
  encodeBytesField,
  encryptedMessageAad,
  LunaCryptoSession,
  packetChecksum,
  parseDirectMessagePacket,
  parseEncryptedMessagePacket,
  parseGetOptionsResponse,
} from '../electron/devices/insta360/lunaBleCodec.ts'

const optionsRequest = buildGetOptionsRequest([36, 37, 43])
assert.equal(optionsRequest.toString('hex'), '08240825082b', '官方 GetOptions 应使用非 packed repeated 编码')

const plain = buildDirectMessagePacket(8, optionsRequest, 7, 1)
assert.equal(plain.subarray(0, 12).toString('hex'), '55434432010c04010f000000')
assert.equal(plain.readUInt32LE(plain.length - 4), packetChecksum(plain.subarray(0, -4)))
const parsedPlain = parseDirectMessagePacket(plain)
assert(parsedPlain)
assert.equal(parsedPlain.messageCode, 8)
assert.equal(parsedPlain.messageId, 7)
assert.deepEqual(parsedPlain.content, optionsRequest)

const wifiInfo = Buffer.concat([
  encodeStringField(1, 'Luna-Test'),
  encodeStringField(2, 'test-password'),
])
const getOptionsResponse = encodeBytesField(2, encodeBytesField(36, wifiInfo))
assert.deepEqual(parseGetOptionsResponse(getOptionsResponse).wifiInfo, {
  ssid: 'Luna-Test',
  password: 'test-password',
})

const first = new LunaCryptoSession()
const second = new LunaCryptoSession()
first.complete(second.publicKey)
second.complete(first.publicKey)
const encryptedPlaintext = Buffer.from('encrypted message payload')
const aad = encryptedMessageAad(9, encryptedPlaintext.length)
const encrypted = first.encrypt(encryptedPlaintext, aad)
const encryptedPacket = buildEncryptedMessagePacket(encrypted.ciphertext, encrypted.nonce, encrypted.authTag, 9)
const parsedEncrypted = parseEncryptedMessagePacket(encryptedPacket)
assert(parsedEncrypted)
assert.deepEqual(second.decrypt(parsedEncrypted), encryptedPlaintext)

console.log('Luna BLE protocol tests passed')
