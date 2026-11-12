import amqp from 'amqp-connection-manager';
import type { Channel } from 'amqplib';

/**
 * Connect to RabbitMQ and return a connection + channelWrapper with
 * publisher-confirms enabled.
 */
export function connectBroker(url: string) {
  const connection = amqp.connect([url]);
  const channelWrapper = connection.createChannel({
    json: false,
    publishTimeout: 10_000,
    setup: (ch: Channel) => ch.prefetch(5),
  });
  return { connection, channelWrapper };
}

/* ------------------------------------------------------------------ */
/*  Topology constants                                                */
/* ------------------------------------------------------------------ */

const EXCHANGES = [
  { name: 'ride.commands', type: 'direct' },
  { name: 'ride.events',   type: 'topic'  },
  { name: 'ride.retry',    type: 'direct' },
  { name: 'ride.dlq',      type: 'direct' },
] as const;

interface QueueBinding {
  queue: string;
  exchange: string;
  routingKey: string;
}

const QUEUE_BINDINGS: QueueBinding[] = [
  { queue: 'payment.commands',    exchange: 'ride.commands', routingKey: 'payment.commands'  },
  { queue: 'matching.commands',   exchange: 'ride.commands', routingKey: 'matching.commands' },
  { queue: 'driver.commands',     exchange: 'ride.commands', routingKey: 'driver.commands'   },
  { queue: 'trip.replies',        exchange: 'ride.commands', routingKey: 'trip.replies'       },
  { queue: 'trip.driver-events',  exchange: 'ride.events',  routingKey: 'driver.*'           },
  { queue: 'driver.trip-events',  exchange: 'ride.events',  routingKey: 'trip.*'             },
  { queue: 'notification.events', exchange: 'ride.events',  routingKey: 'trip.*'             },
];

const RETRY_TIERS = [
  { suffix: 'retry.1s',  ttl: 1_000  },
  { suffix: 'retry.5s',  ttl: 5_000  },
  { suffix: 'retry.15s', ttl: 15_000 },
] as const;

/* ------------------------------------------------------------------ */
/*  Topology setup — call inside channelWrapper.addSetup or standalone */
/* ------------------------------------------------------------------ */

export async function setupTopology(channel: Channel): Promise<void> {
  // 1. Exchanges
  for (const ex of EXCHANGES) {
    await channel.assertExchange(ex.name, ex.type, { durable: true });
  }

  // 2. Main queues + bindings + retry + DLQ
  for (const binding of QUEUE_BINDINGS) {
    // Main queue
    await channel.assertQueue(binding.queue, { durable: true });
    await channel.bindQueue(binding.queue, binding.exchange, binding.routingKey);

    // Retry queues — messages TTL-expire back to the main queue
    for (const tier of RETRY_TIERS) {
      const retryQueue = `${binding.queue}.${tier.suffix}`;
      await channel.assertQueue(retryQueue, {
        durable: true,
        arguments: {
          'x-message-ttl': tier.ttl,
          'x-dead-letter-exchange': '',               // default exchange
          'x-dead-letter-routing-key': binding.queue,  // route back to main
        },
      });
      // Bind retry queue to ride.retry so publishers can target it by rk
      await channel.bindQueue(retryQueue, 'ride.retry', retryQueue);
    }

    // DLQ
    const dlqQueue = `${binding.queue}.dlq`;
    await channel.assertQueue(dlqQueue, { durable: true });
    await channel.bindQueue(dlqQueue, 'ride.dlq', dlqQueue);
  }
}

export { RETRY_TIERS, QUEUE_BINDINGS };
