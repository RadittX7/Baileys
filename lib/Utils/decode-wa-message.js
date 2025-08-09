"use strict"

Object.defineProperty(exports, "__esModule", { value: true })

const boom_1 = require("@hapi/boom")
const WAProto_1 = require("../../WAProto")
const WABinary_1 = require("../WABinary")
const generics_1 = require("./generics")
const messages_1 = require("./messages") 

const NO_MESSAGE_FOUND_ERROR_TEXT = 'Message absent from node'

const MISSING_KEYS_ERROR_TEXT = 'Key used already or never filled'

const NACK_REASONS = {
    ParsingError: 487,
    UnrecognizedStanza: 488,
    UnrecognizedStanzaClass: 489,
    UnrecognizedStanzaType: 490,
    InvalidProtobuf: 491,
    InvalidHostedCompanionStanza: 493,
    MissingMessageSecret: 495,
    SignalErrorOldCounter: 496,
    MessageDeletedOnPeer: 499,
    UnhandledError: 500,
    UnsupportedAdminRevoke: 550,
    UnsupportedLIDGroup: 551,
    DBOperationFailed: 552
}

/**
 * Decode the received node as a message.
 * @note this will only parse the message, not decrypt it
 */
function decodeMessageNode(stanza, meId, meLid) {
    let msgType
    let chatId
    let author
    const msgId = stanza.attrs.id
    const from = stanza.attrs.from
    const mode = stanza.attrs.addressing_mode || 'pn'
    const participant = mode === 'lid' ? (stanza.attrs.participant_pn || stanza.attrs.sender_pn || stanza.attrs.participant) : stanza.attrs.participant
    const recipient = mode === 'lid' ? (stanza.attrs.peer_recipient_pn || stanza.attrs.sender_pn || stanza.attrs.recipient) : stanza.attrs.recipient
    const isMe = (jid) => WABinary_1.areJidsSameUser(jid, meId)
    const isMeLid = (jid) => WABinary_1.areJidsSameUser(jid, meLid)
    
    if (WABinary_1.isJidUser(from) || WABinary_1.isLidUser(from)) {
		   if(recipient /*&& !WABinary_1.isJidMetaIa(recipient)*/) {
			    if (!isMe(from) && !isMeLid(from)) {
				     throw new boom_1.Boom('receipient present, but msg not from me', { data: stanza })
			    }

			    chatId = recipient
		   } else {
		    	chatId = from
		   }

		   msgType = 'chat'
		   author = from
	  }
    else if (WABinary_1.isJidGroup(from)) {
        if (!participant) {
            throw new boom_1.Boom('No participant in group message')
        }
        msgType = 'group'
        author = participant
        chatId = from
    }
    else if (WABinary_1.isJidBroadcast(from)) {
        if (!participant) {
            throw new boom_1.Boom('No participant in group message')
        }
        const isParticipantMe = isMe(participant)
        if (WABinary_1.isJidStatusBroadcast(from)) {
            msgType = isParticipantMe ? 'direct_peer_status' : 'other_status'
        }
        else {
            msgType = isParticipantMe ? 'peer_broadcast' : 'other_broadcast'
        }
        chatId = from
        author = participant
    }
    else if (WABinary_1.isJidNewsletter(from)) {
        msgType = 'newsletter'
        chatId = from
        author = from
    }
    else {
        throw new boom_1.Boom('Unknown message type', { data: stanza })
    }
    const fromMe = WABinary_1.isJidNewsletter(from) ? !!stanza.attrs?.is_sender : WABinary_1.isLidUser(from) ? isMeLid(stanza.attrs.participant || stanza.attrs.from) : isMe(stanza.attrs.participant || stanza.attrs.from)
    const pushname = stanza?.attrs?.notify
    const platform = messages_1.getDevice(msgId)
  	const content = Array.isArray(stanza?.content)
	     ? stanza?.content
	        .filter(item => (!Buffer.isBuffer(item?.content)))
	        .filter(item => !['reporting','enc','verified'].includes(item?.tag))
	     : stanza?.content
    const key = {
        remoteJid: chatId,
        fromMe,
        id: msgId,
        participant: fromMe ? WABinary_1.jidNormalizedUser(meId) : participant,        
		    senderPn: msgType === 'chat'
		       ? WABinary_1.jidNormalizedUser(author).split("@")[0]
		       : participant 
		       ? WABinary_1.jidNormalizedUser(participant).split('@')[0] 
		       : WABinary_1.jidNormalizedUser(recipient).split("@")[0],
	  	  mode,
		    lid: mode === 'lid' ? stanza.attrs.participant : (stanza.attrs.participant_lid || stanza.attrs.sender_lid || stanza.attrs.peer_recipient_lid || stanza.attrs.participant)
    }
    const fullMessage = {
        key,
        messageTimestamp: +stanza.attrs.t,
        pushName: pushname,
        broadcast: WABinary_1.isJidBroadcast(from), 
        newsletter: WABinary_1.isJidNewsletter(from),
        platform: platform === 'unknown' ? 'baileys' : platform,
        attrs: stanza?.attrs,
        content: content,
    }
    if (msgType === 'newsletter') {
        fullMessage.newsletterServerId  = +stanza.attrs?.server_id
        key.server_id = +stanza.attrs?.server_id
    }
    if (key.fromMe) {
        fullMessage.status = WAProto_1.proto.WebMessageInfo.Status.SERVER_ACK
    }
    return {
        fullMessage,
        author,
        sender: msgType === 'chat' ? author : chatId
    }
}

const decryptMessageNode = (stanza, meId, meLid, repository, logger) => {
    const { fullMessage, author, sender, botId } = decodeMessageNode(stanza, meId, meLid)
    return {
        fullMessage,
        category: stanza.attrs.category,
        author,
        async decrypt() {
            let decryptables = 0
            if (Array.isArray(stanza.content)) {
                for (const { tag, attrs, content } of stanza.content) {
                    if (tag === 'verified_name' && content instanceof Uint8Array) {
                        const cert = WAProto_1.proto.VerifiedNameCertificate.decode(content)
                        const details = WAProto_1.proto.VerifiedNameCertificate.Details.decode(cert.details)
                        fullMessage.verifiedBizName = details.verifiedName
                    }
                    if (tag !== 'enc' && tag !== 'plaintext') {
                        continue
                    }
                    if (tag === 'meta' && attrs.status_mentioned) {
                       fullMessage.isMentionedInStatus = true
                       fullMessage.statusMentionSources = []
                       for (const meta of content) {
                          if (meta.tag === 'mention_source') {
                             for (const source of meta.conten) {
                                if (source.tag === 'to') {
                                   fullMessage.statusMentionSources.push(source.attrs.jid)
                                }
                             }
                          }
                       }
                    }
                    if (!(content instanceof Uint8Array)) {
                        continue
                    }
                    decryptables += 1
                    let msgBuffer
                    try {
                        const e2eType = tag === 'plaintext' ? 'plaintext' : attrs.type
                        switch (e2eType) {
                            case 'skmsg':
                                msgBuffer = await repository.decryptGroupMessage({
                                    group: sender,
                                    authorJid: author,
                                    msg: content
                                })
                                break
                            case 'pkmsg':
                            case 'msmsg':
                            case 'msg':
                                const user = WABinary_1.isJidUser(sender) ? sender : author
                                msgBuffer = await repository.decryptMessage({
                                    jid: user,
                                    type: e2eType,
                                    ciphertext: content
                                })
                                break
                            case 'plaintext':
                                msgBuffer = content
                                break
                            default:
                                throw new Error(`Unknown e2e type: ${e2eType}`)
                        }
                        let msg = WAProto_1.proto.Message.decode(e2eType !== 'plaintext' ? generics_1.unpadRandomMax16(msgBuffer) : msgBuffer)
                        msg = msg.deviceSentMessage?.message || msg
                        if (msg.senderKeyDistributionMessage) {
                            //eslint-disable-next-line max-depth
                            try {
                                await repository.processSenderKeyDistributionMessage({
                                    authorJid: author,
                                    item: msg.senderKeyDistributionMessage
                                })
                            }
                            catch (err) {
                                logger.error({ key: fullMessage.key, err }, 'failed to decrypt message')
                            }
                        }
                        if (fullMessage.message) {
                            Object.assign(fullMessage.message, msg)
                        }
                        else {
                            fullMessage.message = msg
                        }
                    }
                    catch (err) {
                        logger.error({ key: fullMessage.key, err }, 'failed to decrypt message')
                        fullMessage.messageStubType = WAProto_1.proto.WebMessageInfo.StubType.CIPHERTEXT
                        fullMessage.messageStubParameters = [err.message]
                    }
                }
            }
            // if nothing was found to decrypt
            if (!decryptables) {
                fullMessage.messageStubType = WAProto_1.proto.WebMessageInfo.StubType.CIPHERTEXT
                fullMessage.messageStubParameters = [NO_MESSAGE_FOUND_ERROR_TEXT]
            }
        }
    }
}

module.exports = {
  decodeMessageNode, 
  decryptMessageNode
}