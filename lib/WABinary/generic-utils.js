"use strict"

Object.defineProperty(exports, "__esModule", { value: true })

const boom_1 = require("@hapi/boom")
const WAProto_1 = require("../../WAProto")
const Utils_1 = require("../Utils")

// some extra useful utilities
const getBinaryNodeChildren = (node, childTag) => {
    if (Array.isArray(node?.content)) {
        return node.content.filter(item => item.tag === childTag)
    }
    return []
}

const getAllBinaryNodeChildren = ({ content }) => {
    if (Array.isArray(content)) {
        return content
    }
    return []
}

const getBinaryNodeChild = (node, childTag) => {
    if (Array.isArray(node?.content)) {
        return node?.content.find(item => item.tag === childTag)
    }
}

const getBinaryNodeChildBuffer = (node, childTag) => {
    const child = getBinaryNodeChild(node, childTag)?.content
    if (Buffer.isBuffer(child) || child instanceof Uint8Array) {
        return child
    }
}

const getBinaryNodeChildString = (node, childTag) => {
    const child = getBinaryNodeChild(node, childTag)?.content
    if (Buffer.isBuffer(child) || child instanceof Uint8Array) {
        return Buffer.from(child).toString('utf-8')
    }
    else if (typeof child === 'string') {
        return child
    }
}

const getBinaryNodeChildUInt = (node, childTag, length) => {
    const buff = getBinaryNodeChildBuffer(node, childTag)
    if (buff) {
        return bufferToUInt(buff, length)
    }
}

const assertNodeErrorFree = (node) => {
    const errNode = getBinaryNodeChild(node, 'error')
    if (errNode) {
        throw new boom_1.Boom(errNode.attrs.text || 'Unknown error', { data: +errNode.attrs.code })
    }
}

const reduceBinaryNodeToDictionary = (node, tag) => {
    const nodes = getBinaryNodeChildren(node, tag)
    const dict = nodes.reduce((dict, { attrs }) => {
        dict[attrs.name || attrs.config_code] = attrs.value || attrs.config_value
        return dict
    }, {})
    return dict
}

const getBinaryNodeMessages = ({ content }) => {
    const msgs = []
    if (Array.isArray(content)) {
        for (const item of content) {
            if (item.tag === 'message') {
                msgs.push(WAProto_1.proto.WebMessageInfo.decode(item.content))
            }
        }
    }
    return msgs
}

const getBinaryNodeFilter = (node) => {
   if (!Array.isArray(node)) return false
   
   return node.some(item => 
      ['native_flow'].includes(item?.content?.[0]?.content?.[0]?.tag) ||
      ['interactive', 'buttons', 'list'].includes(item?.content?.[0]?.tag) ||
      ['hsm', 'biz'].includes(item?.tag) ||
      ['bot'].includes(item?.tag) && item?.attrs?.biz_bot === '1'
   )
}

const getAdditionalNode = (name) => {
   if (name) name = name.toLowerCase()
   const ts = Utils_1.unixTimestampSeconds(new Date())  - 77980457
   
   const order_response_name = {
      review_and_pay: 'order_details',
      review_order: 'order_status',
      payment_info: 'payment_info',
      payment_status: 'payment_status',
      payment_method: 'payment_method'
   }
   
   const flow_name = {
      cta_catalog: 'cta_catalog',
      mpm: 'mpm',
      call_request: 'call_permission_request',
      view_catalog: 'automated_greeting_message_view_catalog',
      wa_pay_detail: 'wa_payment_transaction_details',
      send_location: 'send_location',
   }
   
   if(order_response_name[name]) {
      return [{
          tag: 'biz',
          attrs: { 
             native_flow_name: order_response_name[name] 
          },
          content: []
      }]
   } else if (flow_name[name] || name === 'interactive' || name === 'buttons') {
      return [{
         tag: 'biz',
         attrs: { 
            actual_actors: '2',
            host_storage: '2',
            privacy_mode_ts: `${ts}`
         },
         content: [{
            tag: 'engagement',
            attrs: {
               customer_service_state: 'open',
               conversation_state: 'open'
            }
         },
         {
            tag: 'interactive',
			   		attrs: {
				   	   type: 'native_flow',
			      	 v: '1'
						},
						content: [{
			   			 tag: 'native_flow',
			   			 attrs: { 
			   			    v: '9',
			   					name: flow_name[name] ?? 'mixed',
			   		   },
			   			 content: []
					  }]
         }]
      }]
   } else if (name === 'list') {
      return [{
         tag: 'biz',
         attrs: {
            actual_actors: '2',
            host_storage: '2',
            privacy_mode_ts: `${ts}`
         },
         content: [{
            tag: 'engagement',
            attrs: {
               customer_service_state: 'open',
               conversation_state: 'open'
            }
         },
         {
            tag: 'list',
            attrs: { 
               v: '2',
               type: 'product_list'
            }
         }]
      }]
   } else if (flow_name[name] || name === 'templateInteractive') {
      return [{
         tag: 'biz',
         attrs: {
            actual_actors: '2',
            host_storage: '2',
            privacy_mode_ts: `${ts}`
         },
         content: [{
            tag: 'engagement',
            attrs: {
               customer_service_state: 'open',
               conversation_state: 'open'
            }
         },
         {
            tag: 'interactive',
			   		attrs: {
				   	   type: 'native_flow',
			      	 v: '1'
						},
						content: [{
			   			 tag: 'native_flow',
			   			 attrs: { 
			   			    v: '9',
			   					name: flow_name[name] ?? 'mixed',
			   		   },
			   			 content: []
					  }]
         }]
      }, {
         tag: 'hsm', 
         attrs: {
             category: 'NON_TRANSACTIONAL', 
             tag: 'UTILITY'
         }
      }]
   } else if (name === 'template') {
      return [{
         tag: 'biz',
         attrs: {
            actual_actors: '2',
            host_storage: '2',
            privacy_mode_ts: `${ts}`
         },
         content: [{
            tag: 'engagement',
            attrs: {
               customer_service_state: 'open',
               conversation_state: 'open'
            }
         }]
      }, {
         tag: 'hsm', 
         attrs: {
             category: 'NON_TRANSACTIONAL', 
             tag: 'UTILITY'
         }
      }]
   } else if (name === 'bot') {
      return [{ 
				 tag: 'bot', 
			   attrs: { biz_bot: '1' }
	    }]
   } else {
      return [{
         tag: 'biz',
         attrs: {
            actual_actors: '2',
            host_storage: '2',
            privacy_mode_ts: `${ts}`
         },
         conten: [{
            tag: 'engagement',
            attrs: {
               customer_service_state: 'open',
               conversation_state: 'open'
            }
         }]
      }]
   }
}

function bufferToUInt(e, t) {
    let a = 0
    for (let i = 0; i < t; i++) {
        a = 256 * a + e[i]
    }
    return a
}
const tabs = (n) => '\t'.repeat(n)
function binaryNodeToString(node, i = 0) {
    if (!node) {
        return node
    }
    if (typeof node === 'string') {
        return tabs(i) + node
    }
    if (node instanceof Uint8Array) {
        return tabs(i) + Buffer.from(node).toString('hex')
    }
    if (Array.isArray(node)) {
        return node.map((x) => tabs(i + 1) + binaryNodeToString(x, i + 1)).join('\n')
    }
    const children = binaryNodeToString(node.content, i + 1)
    const tag = `<${node.tag} ${Object.entries(node.attrs || {})
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}='${v}'`)
        .join(' ')}`
    const content = children ? `>\n${children}\n${tabs(i)}</${node.tag}>` : '/>'
    return tag + content
}

module.exports = {
  getBinaryNodeChildren, 
  getAllBinaryNodeChildren, 
  getBinaryNodeChild, 
  getBinaryNodeChildBuffer, 
  getBinaryNodeChildString, 
  getBinaryNodeChildUInt, 
  assertNodeErrorFree, 
  reduceBinaryNodeToDictionary, 
  getBinaryNodeMessages, 
  getBinaryNodeFilter, 
  getAdditionalNode,
  binaryNodeToString
}