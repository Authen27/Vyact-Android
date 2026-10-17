package com.vyact.app;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.List;

/**
 * CI guard: runs the Java message parser over native/sms-fixtures.tsv — the same file the TypeScript
 * parser's vitest runs — so the two implementations cannot drift apart. Plain javac, no Android:
 *   javac -encoding UTF-8 -d out native/sms/.../SmsLeanParser.java native/tools/SmsParityCheck.java
 *   java -cp out com.vyact.app.SmsParityCheck native/sms-fixtures.tsv
 */
public final class SmsParityCheck {
  public static void main(String[] args) throws IOException {
    List<String> lines = Files.readAllLines(Paths.get(args[0]), StandardCharsets.UTF_8);
    int rows = 0;
    int bad = 0;
    for (String line : lines) {
      if (line.isEmpty() || line.startsWith("#")) continue;
      String[] f = line.split("\t", -1);
      if (f.length < 3) { System.out.println("MALFORMED ROW: " + line); bad++; continue; }
      rows++;
      SmsLeanParser.Result r = SmsLeanParser.parse(f[0], f[1]);
      String got = r == null ? "-" : r.dir + "|" + r.amountText + "|" + r.currency + "|" + (r.counterparty == null ? "" : r.counterparty);
      if (!got.equals(f[2])) {
        bad++;
        System.out.println("MISMATCH  " + f[0] + ": " + f[1]);
        System.out.println("  expected " + f[2]);
        System.out.println("  java got " + got);
      }
    }
    System.out.println("SMS parser parity: " + (rows - bad) + "/" + rows + " rows agree");
    if (bad > 0 || rows == 0) System.exit(1);
  }
}
