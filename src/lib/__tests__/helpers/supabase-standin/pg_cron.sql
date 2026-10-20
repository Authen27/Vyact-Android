-- Q2 (v10.129.0): the pg_cron stand-in. The migrations' own `create extension if not exists pg_cron` runs this
-- (helpers/replayMigrations.ts installs it as an extension), so a migration that used cron before creating it
-- would fail here as it would in production. Jobs are recorded, never run.
create schema cron;

create table cron.job (
  jobid    bigserial primary key,
  schedule text not null,
  command  text not null,
  nodename text not null default 'localhost',
  nodeport int not null default 5432,
  database text not null default current_database(),
  username text not null default current_user,
  active   boolean not null default true,
  jobname  text unique
);
create table cron.job_run_details (
  jobid          bigint,
  runid          bigserial primary key,
  job_pid        int,
  database       text,
  username       text,
  command        text,
  status         text,
  return_message text,
  start_time     timestamptz,
  end_time       timestamptz
);

-- Scheduling a name that exists replaces its schedule and command, as pg_cron does.
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid $$;
create function cron.schedule(schedule text, command text) returns bigint language sql as $$
  insert into cron.job (schedule, command) values (schedule, command) returning jobid $$;

create function cron.unschedule(job_name text) returns boolean language plpgsql as $$
begin
  delete from cron.job where jobname = job_name;
  if not found then raise exception 'could not find valid entry for job ''%''', job_name; end if;
  return true;
end $$;
create function cron.unschedule(job_id bigint) returns boolean language plpgsql as $$
begin
  delete from cron.job where jobid = job_id;
  if not found then raise exception 'could not find valid entry for job %', job_id; end if;
  return true;
end $$;

create function cron.alter_job(job_id bigint, schedule text default null, command text default null,
  database text default null, username text default null, active boolean default null) returns void language plpgsql as $$
begin
  update cron.job j set schedule = coalesce(alter_job.schedule, j.schedule),
                        command  = coalesce(alter_job.command, j.command),
                        active   = coalesce(alter_job.active, j.active)
  where j.jobid = job_id;
  if not found then raise exception 'could not find valid entry for job %', job_id; end if;
end $$;
