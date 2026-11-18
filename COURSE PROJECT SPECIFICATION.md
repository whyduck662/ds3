## COURSE PROJECT SPECIFICATION

## Course: Distributed Systems

## 1. Project Objectives

Students will apply knowledge of distributed system architecture, inter-process communication, naming and service discovery, synchronization, concurrency control, data consistency, replication, fault tolerance, recovery, and security to build a distributed system prototype.

Upon completion of the project, students should demonstrate the ability to:

- Analyze a problem and identify distributed-system issues that need to be addressed.

- Select appropriate architectures, protocols, and algorithms.

- Build independent processes, peers, or services that communicate over a network.

- Handle multiple concurrent requests or users.

- Manage state and maintain consistency.

- Detect, handle, and recover from selected failures.

- Test and evaluate the system.

- Write a technical report, demonstrate, and defend the solution.

## 2. Project Format

- Students work in groups of no more than 3 members.

- Each group selects one of the four specified topics.

- Groups selecting the same topic may use different technologies and solutions.

- Each member must be responsible for a specific part of the work and provide evidence of contribution on GitHub.

- Each member must understand the overall architecture and be able to explain their assigned work.

- Groups must register their topic, members, preliminary architecture, and intended technologies with the instructor.

## 3. List of Topics

| Code | Topic | Main Distributed Systems Concepts |
| --- | --- | --- |
|   | DS01 P2P chat system simulating Skype | P2P, super-peer/relay, NAT, peer discovery, reliable communication |
| DS02 | P2P file-sharing system simulating BitTorrent | P2P, tracker, data chunking and replication, parallel downloading, churn |


| Code | Topic | Main Distributed Systems Concepts |
| --- | --- | --- |
| DS03 | Ride-hailing microservices system simulating Grab/Uber | REST, message queue, distributed transactions, eventual consistency, fault tolerance |
| DS04 | Collaborative document editing system simulating Google Docs | Real-time synchronization, causality, OT/CRDT, conflict handling |

## 4. General Requirements for All Topics

## 4.1. Distributed Nature

The system must consist of at least three independent processes, peers, clients, or services.

## Components must:

- Run as separate processes, applications, virtual machines, or containers.

- Communicate over a network using sockets, HTTP, WebSocket, gRPC, message queues, or equivalent protocols.

- Have unique identities.

- Be capable of handling multiple concurrent connections or requests.

- Not use global variables, shared memory, or shared files as substitutes for network communication.

- Produce logs showing nodes, timestamps, event types, and processing results.

## The system may be deployed:

- On multiple computers in a LAN.

- On computers located in different Internet networks.

- On virtual machines or cloud servers.

- In containers with independent processes and networks.

- Using a combination of the above approaches.

## 4.2. Architecture and Communication

Groups must design and present:

- Components and the responsibilities of each component.

- Naming and identification mechanisms.

- Peer discovery or service discovery mechanisms.

- Communication protocols.

- Message formats.

- How distributed state is managed.

- How online/offline components are detected.

- Timeouts, acknowledgements, and retries.


- Mechanisms for handling duplicate or out-of-order messages.

- Constraints related to performance, scalability, and availability.

## 4.3. Concurrency and Consistency

The system must include at least one scenario involving concurrent actions by multiple processes or users.

## Groups must:

- Identify possible conflicts.

- Define the intended consistency model.

- Design a concurrency-control mechanism.

- Test the system using concurrent operations.

- Demonstrate that the final state of the system satisfies the requirements.

Depending on the topic, groups may use:

- Sequence numbers.

- Lamport logical clocks.

- Vector clocks.

- Version numbers.

- Idempotency keys.

- Optimistic concurrency control.

- Event logs.

- Saga.

- Operational Transformation.

- CRDT.

## 4.4. Fault Tolerance and Recovery

Groups must identify a failure model and demonstrate at least two failure scenarios, such as:

- A peer or service unexpectedly leaves the network.

- A client loses connectivity.

- A super-peer or relay does not respond.

- A message is lost, duplicated, or arrives out of order.

- A file download is interrupted.

- A service fails to process a message.

- A document-editing client loses connectivity.

The system must use appropriate mechanisms such as:

- Timeout.

- Bounded retry.


- Acknowledgement.

- Heartbeat or lease.

- Deduplication.

- Checkpointing or intermediate state persistence.

- Reconnection.

- Resume.

- Failover.

- Dead-letter queue.

- Circuit breaker.

- Compensating transactions.

## 4.5. Basic Security

- Authenticate users, peers, or services.

- Enforce access control for resources.

- Validate and sanitize input data.

- Do not store passwords in plaintext.

- Do not commit tokens, passwords, or secret keys to GitHub.

- Use environment variables for secret configuration.

- Limit message or file sizes.

- Log important activities.

- The use of TLS or message encryption is encouraged.

## 7. Topic DS03: Build a Ride-Hailing Microservices System Simulating Grab/Uber

## 7.1. Objective

Build a ride-hailing system using a microservices architecture. Services must be deployed independently and communicate using RESTful APIs and message queues.

## 7.2. Minimum Services

The system must include at least four business microservices selected from:

- Identity/User Service.

- Driver/Vehicle/Location Service.

- Trip/Booking Service.

- Matching Service.

- Pricing Service.

- Simulated Payment Service.

- Notification Service.

An API Gateway does not count as a business microservice.

Each service must have its own data or separate data schema and must not directly access another service’s database.

## 7.3. Functional Requirements

- User registration, login, and passenger/driver role assignment.

- Drivers update their status and simulated location.

- Passengers create ride requests.

- Find and select suitable drivers.

- Drivers accept or reject trips.

- A driver must not be assigned to two trips simultaneously.

- Manage the trip lifecycle.

- Calculate fare and simulate payment.


- Send notifications to passengers and drivers.

The following are mandatory:

- At least one REST or gRPC communication flow.

- At least one asynchronous communication flow using a message queue.

- Event IDs or idempotency keys.

- Retries.

- Deduplication.

- A dead-letter queue or error-message storage.

- Correlation IDs.

- One distributed transaction using Saga or compensating actions.

## 7.4. Mandatory Demonstration Scenarios

- Start services independently.

- Drivers become available.

- A passenger requests a ride.

- The Matching Service selects a driver.

- The driver accepts and completes the trip.

- Two passengers simultaneously request the same driver.

- Stop one service during a business flow.

- Demonstrate retry, queue handling, or compensation.

- Restart the service and continue processing messages.

## 7.5. Advanced Features

- API Gateway and service discovery.

- Circuit breaker.

- Outbox pattern.

- Distributed tracing.

- Centralized logging.

- Multiple-instance scaling.

- Dynamic pricing.

- Geospatial matching.

- Docker Compose, Kubernetes, or cloud deployment.

- Service-monitoring dashboard.


