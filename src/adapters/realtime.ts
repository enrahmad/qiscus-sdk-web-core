import If from '@ts-delight/if-expr.macro'
import getSyncAdapter from './sync'
import { Callback, Subscription } from '../defs'
import xs from 'xstream'
import getMqttAdapter from './mqtt'
import { subscribeOnNext } from '../utils/stream'
import * as model from '../model'
import { getLogger } from './logger'
import { Storage } from '../storage'

export type SyncMethod<T extends any[]> = (
  callback: (...data: T) => void,
) => Subscription;

function fromSync<T extends any[]> (method: SyncMethod<T>) {
  let subscription: Subscription = null
  return xs.create<T>({
    start (listener) {
      subscription = method((...data) => {
        listener.next([...data] as T)
      })
    },
    stop () {
      subscription()
    },
  })
}

function isChatRoom (data: model.IQChatRoom | number): data is model.IQChatRoom {
  return (data as model.IQChatRoom).id != null
}

function isNumber (data: model.IQChatRoom | number): data is number {
  return typeof (data as number) === 'number'
}

export type RealtimeAdapter = ReturnType<typeof getRealtimeAdapter>
export default function getRealtimeAdapter (
  //region Params
  storage: Storage,
  //endregion
) {
  const mqtt = getMqttAdapter(storage)
  const logger = getLogger(storage)
  const sync = getSyncAdapter({
    s: storage,
    shouldSync () {
      // if (mqtt.mqtt == null) return true
      return mqtt.mqtt?.connected !== true
    },
    logger: (...args: string[]) => logger.log(...args),
  })

  // sync.onSynchronized(() => {
    // logger.log(`mqtt connected state: ${mqtt.mqtt?.connected}`)
    // logger.log(`mqtt reconnecting: ${mqtt.mqtt?.reconnecting}`)
    // If(!mqtt.mqtt?.connected)
    //   .thenDo(logger.log(`mqtt reconnecting to broker: ${mqtt.mqtt?.options['href']}`))
    //   .then(mqtt.mqtt?.reconnect())()
  // })

  // region emitter
  const newMessage$ = xs.merge(
    fromSync(sync.onNewMessage),
    fromSync(mqtt.onNewMessage),
  )
  const onMessageRead$ = xs.merge(
    fromSync(sync.onMessageRead),
    fromSync(mqtt.onMessageRead),
  )
  const onMessageDelivered$ = xs.merge(
    fromSync(sync.onMessageDelivered),
    fromSync(mqtt.onMessageDelivered),
  )
  const onMessageDeleted$ = xs.merge(
    fromSync(sync.onMessageDeleted),
    fromSync(mqtt.onMessageDeleted),
  )
  const onRoomCleared$ = xs.merge(
    fromSync(sync.onRoomCleared),
    fromSync(mqtt.onRoomDeleted),
  )
  // endregion

  return {
    sync: sync,
    get mqtt () {
      return mqtt
    },
    clear(): void {
      mqtt.clear()
    },
    onMessageDeleted (callback: Callback<model.IQMessage>): Subscription {
      const subscription = onMessageDeleted$
        .compose(subscribeOnNext(([message]) => callback(message)))
      return () => subscription.unsubscribe()
    },
    onMessageDelivered (callback: Callback<model.IQMessage>): Subscription {
      const subscription = onMessageDelivered$
        .compose(subscribeOnNext(([it]) => callback(it)))
      return () => subscription.unsubscribe()
    },
    onMessageRead (callback: Callback<model.IQMessage>): Subscription {
      const subscription = onMessageRead$
        .compose(subscribeOnNext(([it]) => callback(it)))
      return () => subscription.unsubscribe()
    },
    onNewMessage (callback: Callback<model.IQMessage>): Subscription {
      const subscription = newMessage$
        .compose(subscribeOnNext(([message]) => callback(message)))
      return () => subscription.unsubscribe()
    },
    onNewMessage$ () { return newMessage$.map(([msg]) => msg) },
    onMessageRead$ () { return onMessageRead$.map(([it]) => it) },
    onMessageDelivered$ () { return onMessageDelivered$.map(([it]) => it) },
    get onMessageDeleted$ () {
      return onMessageDeleted$.map(([it]) => it)
    },
    onRoomCleared$ () { return onRoomCleared$.map(([it]) => it) },
    onPresence (
      callback: (userId: string, isOnline: boolean, lastSeen: Date) => void,
    ): Subscription {
      const subscription = fromSync(mqtt.onUserPresence)
        .compose(subscribeOnNext(([userId, isOnline, lastSeen]) =>
          callback(userId, isOnline, lastSeen),
        ))
      return () => subscription.unsubscribe()
    },
    onRoomCleared (callback: Callback<number>): Subscription {
      const subscription = onRoomCleared$
        .compose(subscribeOnNext(([room]) => {
          if (isNumber(room)) callback(room)
          if (isChatRoom(room)) callback(room.id)
        }))
      return () => subscription.unsubscribe()
    },
    onTyping (
      callback: (userId: string, roomId: number, isTyping: boolean) => void,
    ): Subscription {
      const subscription = fromSync(mqtt.onUserTyping).compose(
        subscribeOnNext(([userId, roomId, isTyping]) =>
          callback(userId, roomId, isTyping),
        ),
      )
      return () => subscription.unsubscribe()
    },
    sendPresence (userId: string, isOnline: boolean): void {
      mqtt.sendPresence(userId, isOnline)
    },
    sendTyping (roomId: number, userId: string, isTyping: boolean): void {
      mqtt.sendTyping(roomId, userId, isTyping)
    },
    synchronize (lastMessageId: model.IQAccount['lastMessageId']): void {
      sync.synchronize(lastMessageId)
    },
    synchronizeEvent (lastEventId: model.IQAccount['lastSyncEventId']): void {
      sync.synchronizeEvent(lastEventId)
    },
  }
}
