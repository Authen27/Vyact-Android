-- Q2 (v10.129.0): the pg_net stand-in, run by the migrations' own `create extension if not exists pg_net`
-- (helpers/replayMigrations.ts). Like pg_net, its objects live in the `net` schema whatever schema the
-- extension is created "with". Requests are queued in a table and never sent.
create schema net;

create table net.http_request_queue (
  id                   bigserial primary key,
  method               text not null,
  url                  text not null,
  headers              jsonb,
  body                 jsonb,
  timeout_milliseconds int
);
create table net._http_response (
  id           bigint,
  status_code  int,
  content_type text,
  headers      jsonb,
  content      text,
  timed_out    boolean,
  error_msg    text,
  created      timestamptz not null default now()
);

create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds int default 5000)
  returns bigint language sql as $$
  insert into net.http_request_queue (method, url, headers, body, timeout_milliseconds)
  values ('POST', url, headers, body, timeout_milliseconds) returning id $$;
create function net.http_get(url text, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb,
  timeout_milliseconds int default 5000) returns bigint language sql as $$
  insert into net.http_request_queue (method, url, headers, timeout_milliseconds)
  values ('GET', url, headers, timeout_milliseconds) returning id $$;
