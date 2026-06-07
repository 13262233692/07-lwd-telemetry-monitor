package com.lwd.telemetry;

import com.lwd.telemetry.netty.MptNettyServer;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.ConfigurableApplicationContext;

@Slf4j
@SpringBootApplication
public class TelemetryGatewayApplication {

    public static void main(String[] args) {
        ConfigurableApplicationContext ctx = SpringApplication.run(TelemetryGatewayApplication.class, args);

        try {
            MptNettyServer nettyServer = ctx.getBean(MptNettyServer.class);
            nettyServer.start();
            log.info("=== LWD MPT Telemetry Gateway Started ===");
        } catch (Exception e) {
            log.error("Failed to start Netty TCP server", e);
        }
    }
}
